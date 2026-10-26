// Video Hub: biểu tượng trên thanh menu để Long tự bật/tắt nhà máy video (TTS VieNeu + engine Remotion).
// Không tự chạy khi khởi động máy; thoát app là tắt luôn hai dịch vụ.
import Cocoa

let info = Bundle.main.infoDictionary ?? [:]
let root = info["VHRoot"] as? String ?? ""
let envPath = info["VHPath"] as? String ?? "/usr/bin:/bin"
let nodeBin = info["VHNode"] as? String ?? "node"
let uvBin = info["VHUv"] as? String ?? "uv"
let logDir = NSHomeDirectory() + "/Library/Logs"
// Cấu hình chung với engine/TTS (server/config.mjs, tts/server.py): {"dataDir": "..."}
let configDir = NSHomeDirectory() + "/Library/Application Support/VideoHub"
let configFile = configDir + "/config.json"
let defaultDataDir = NSHomeDirectory() + "/Movies/VideoHub"

func readConfig() -> [String: Any] {
    guard let d = FileManager.default.contents(atPath: configFile) else { return [:] }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
}

func dataDir() -> String { readConfig()["dataDir"] as? String ?? defaultDataDir }

func setDataDir(_ path: String) throws {
    var c = readConfig()
    c["dataDir"] = path
    try FileManager.default.createDirectory(atPath: configDir, withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: c, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: configFile))
}

// Ổ ngoài (/Volumes/<tên>) chưa cắm thì không dùng được
func volumeMissing(_ path: String) -> String? {
    let parts = path.split(separator: "/")
    guard parts.count >= 2, parts[0] == "Volumes" else { return nil }
    return FileManager.default.fileExists(atPath: "/Volumes/\(parts[1])") ? nil : String(parts[1])
}

func freeSpace(_ path: String) -> String {
    var p = path
    while !FileManager.default.fileExists(atPath: p) && p != "/" { p = (p as NSString).deletingLastPathComponent }
    guard let a = try? URL(fileURLWithPath: p).resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
          let b = a.volumeAvailableCapacityForImportantUsage else { return "?" }
    return ByteCountFormatter.string(fromByteCount: b, countStyle: .file)
}

struct Health { var tts = false; var engine = false; var running = 0; var queue = 0; var done = 0 }

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    var tts: Process?
    var engine: Process?
    var health = Health()
    var wanted = false
    var timer: Timer?
    var moving = false

    func applicationDidFinishLaunching(_ n: Notification) {
        menu.delegate = self
        item.menu = menu
        if CommandLine.arguments.contains("--start") { startAll() } else { refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func applicationWillTerminate(_ n: Notification) { stopAll() }

    // ---- dịch vụ ----
    func spawn(_ exe: String, _ args: [String], cwd: String, log: String) -> Process? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: cwd)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = envPath
        p.environment = env
        FileManager.default.createFile(atPath: log, contents: nil)
        if let h = FileHandle(forWritingAtPath: log) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
        do { try p.run(); return p } catch { alert("Không chạy được \(exe): \(error.localizedDescription)"); return nil }
    }

    @objc func startAll() {
        let dir = dataDir()
        if let v = volumeMissing(dir) {
            alert("Ổ \"\(v)\" chưa cắm nên chưa lưu video được vào \(dir).\nCắm ổ hoặc chọn \"Đổi nơi lưu video…\" rồi bật lại.")
            return
        }
        do { try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true) } catch {
            alert("Không tạo được thư mục \(dir): \(error.localizedDescription)"); return
        }
        wanted = true
        if !health.tts && tts?.isRunning != true {
            tts = spawn(uvBin, ["run", "--frozen", "python", "server.py"], cwd: root + "/tts", log: logDir + "/video-hub-tts.log")
        }
        if !health.engine && engine?.isRunning != true {
            // caffeinate -i: Mac không ngủ khi rảnh trong lúc nhà máy bật
            engine = spawn("/usr/bin/caffeinate", ["-i", nodeBin, "server/index.mjs"], cwd: root, log: logDir + "/video-hub.log")
        }
        refresh()
    }

    @objc func stopAll() {
        wanted = false
        for p in [engine, tts] { if let p = p, p.isRunning { p.terminate() } }
        engine = nil; tts = nil
        // cả tiến trình chạy ngoài app (mở bằng terminal) và Chrome của Remotion còn sót
        for pat in ["node server/index.mjs", "python server.py", "chrome-headless-shell"] {
            let k = Process()
            k.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            k.arguments = ["-f", pat]
            try? k.run(); k.waitUntilExit()
        }
        refresh()
    }

    @objc func openFolder() { NSWorkspace.shared.open(URL(fileURLWithPath: dataDir())) }

    @objc func changeDataDir() {
        let old = dataDir()
        let panel = NSOpenPanel()
        panel.title = "Chọn nơi lưu video"
        panel.message = "Nên chọn thư mục KHÔNG đồng bộ iCloud (không nằm trong Desktop/Documents), ví dụ ~/Movies hoặc ổ ngoài."
        panel.prompt = "Lưu video ở đây"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.directoryURL = URL(fileURLWithPath: FileManager.default.fileExists(atPath: old) ? old : NSHomeDirectory() + "/Movies")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let new = url.standardizedFileURL.path
        if new == old { return }
        if new.hasPrefix(NSHomeDirectory() + "/Desktop") || new.hasPrefix(NSHomeDirectory() + "/Documents") || new.contains("/Mobile Documents/") {
            let a = NSAlert()
            a.messageText = "Thư mục này đang đồng bộ iCloud"
            a.informativeText = "Video sẽ bị đẩy lên iCloud. Vẫn dùng thư mục này?"
            a.addButton(withTitle: "Chọn lại"); a.addButton(withTitle: "Vẫn dùng")
            if a.runModal() == .alertFirstButtonReturn { return changeDataDir() }
        }
        guard FileManager.default.isWritableFile(atPath: new) else { return alert("Không ghi được vào \(new).") }
        let oldJobs = (try? FileManager.default.contentsOfDirectory(atPath: old + "/jobs")) ?? []
        var move = false
        if !oldJobs.isEmpty {
            let a = NSAlert()
            a.messageText = "Chuyển \(oldJobs.count) video cũ sang chỗ mới?"
            a.informativeText = "Chuyển thì link tải cũ của agent vẫn dùng được. Không chuyển thì video cũ nằm lại ở \(old) và link cũ hết tác dụng."
            a.addButton(withTitle: "Chuyển"); a.addButton(withTitle: "Để lại")
            move = a.runModal() == .alertFirstButtonReturn
        }
        // engine/TTS chỉ đọc nơi lưu lúc khởi động: tắt, đổi, bật lại
        let wasOn = wanted || health.engine || health.tts
        if wasOn { stopAll() }
        moving = true; draw()
        DispatchQueue.global().async {
            var err: String?
            do {
                try setDataDir(new)
                if move {
                    let fm = FileManager.default
                    for sub in ["jobs", "tts"] {
                        try fm.createDirectory(atPath: new + "/" + sub, withIntermediateDirectories: true)
                        for f in (try? fm.contentsOfDirectory(atPath: old + "/" + sub)) ?? [] where !fm.fileExists(atPath: new + "/" + sub + "/" + f) {
                            try fm.moveItem(atPath: old + "/" + sub + "/" + f, toPath: new + "/" + sub + "/" + f)
                        }
                    }
                }
            } catch { err = error.localizedDescription }
            DispatchQueue.main.async {
                self.moving = false
                if let e = err { self.alert("Đổi nơi lưu bị lỗi: \(e)") }
                if wasOn { self.startAll() } else { self.draw() }
            }
        }
    }
    @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: logDir + "/video-hub.log")) }
    @objc func openTtsLog() { NSWorkspace.shared.open(URL(fileURLWithPath: logDir + "/video-hub-tts.log")) }
    @objc func quit() { stopAll(); NSApp.terminate(nil) }

    func alert(_ s: String) {
        let a = NSAlert(); a.messageText = "Video Hub"; a.informativeText = s; a.runModal()
    }

    // ---- trạng thái ----
    func get(_ url: String, _ done: @escaping ([String: Any]?) -> Void) {
        var r = URLRequest(url: URL(string: url)!); r.timeoutInterval = 2
        URLSession.shared.dataTask(with: r) { d, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            done(ok ? ((try? JSONSerialization.jsonObject(with: d ?? Data())) as? [String: Any] ?? [:]) : nil)
        }.resume()
    }

    func refresh() {
        var h = Health()
        let g = DispatchGroup()
        g.enter(); get("http://127.0.0.1:8811/health") { j in h.tts = (j?["ok"] as? Bool) == true; g.leave() }
        g.enter(); get("http://127.0.0.1:8810/health") { j in
            if let j = j {
                h.engine = true
                h.running = j["running"] as? Int ?? 0; h.queue = j["queue"] as? Int ?? 0; h.done = j["done"] as? Int ?? 0
            }
            g.leave()
        }
        g.notify(queue: .main) { self.health = h; self.draw() }
    }

    func draw() {
        let h = health
        let on = h.tts && h.engine
        let starting = wanted && !on
        let symbol = h.running > 0 ? "film.stack.fill" : on ? "film.fill" : "film"
        if let b = item.button {
            b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Video Hub")
            b.title = h.running > 0 ? " dựng" : starting ? " …" : ""
            b.appearsDisabled = !on && !starting
        }
        menu.removeAllItems()
        let head = NSMenuItem(title: on ? "Nhà máy video: ĐANG BẬT" : starting ? "Đang khởi động…" : "Nhà máy video: đang tắt", action: nil, keyEquivalent: "")
        menu.addItem(head)
        menu.addItem(NSMenuItem(title: "  \(h.tts ? "●" : "○") Giọng đọc VieNeu-TTS", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "  \(h.engine ? "●" : "○") Engine dựng video (Remotion + MCP :8810)", action: nil, keyEquivalent: ""))
        if h.engine {
            menu.addItem(NSMenuItem(title: "  Đang dựng \(h.running) · chờ \(h.queue) · xong \(h.done)", action: nil, keyEquivalent: ""))
        }
        menu.addItem(.separator())
        if on || starting || h.tts || h.engine {
            menu.addItem(withTitle: "Tắt nhà máy", action: #selector(stopAll), keyEquivalent: "s").target = self
        }
        if !on {
            menu.addItem(withTitle: h.tts || h.engine ? "Bật phần còn thiếu" : "Bật nhà máy (TTS + engine)", action: #selector(startAll), keyEquivalent: "b").target = self
        }
        menu.addItem(.separator())
        let dir = dataDir()
        let missing = volumeMissing(dir)
        let short = dir.replacingOccurrences(of: NSHomeDirectory(), with: "~")
        menu.addItem(NSMenuItem(title: moving ? "Đang chuyển video sang chỗ mới…" : missing != nil ? "Lưu tại: \(short) (ổ chưa cắm!)" : "Lưu tại: \(short) · trống \(freeSpace(dir))", action: nil, keyEquivalent: ""))
        if !moving { menu.addItem(withTitle: "Đổi nơi lưu video…", action: #selector(changeDataDir), keyEquivalent: "").target = self }
        menu.addItem(withTitle: "Mở thư mục video", action: #selector(openFolder), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Xem log engine", action: #selector(openLog), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Xem log TTS", action: #selector(openTtsLog), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Thoát (tắt nhà máy)", action: #selector(quit), keyEquivalent: "q").target = self
    }

    func menuWillOpen(_ m: NSMenu) { refresh() }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
