// Video Hub: biểu tượng trên thanh menu để Long tự bật/tắt nhà máy video (TTS VieNeu + engine Remotion).
// Không tự chạy khi khởi động máy; thoát app là tắt luôn hai dịch vụ.
import Cocoa

let info = Bundle.main.infoDictionary ?? [:]
let root = info["VHRoot"] as? String ?? ""
let envPath = info["VHPath"] as? String ?? "/usr/bin:/bin"
let nodeBin = info["VHNode"] as? String ?? "node"
let uvBin = info["VHUv"] as? String ?? "uv"
let logDir = NSHomeDirectory() + "/Library/Logs"

struct Health { var tts = false; var engine = false; var running = 0; var queue = 0; var done = 0 }

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    var tts: Process?
    var engine: Process?
    var health = Health()
    var wanted = false
    var timer: Timer?

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

    @objc func openFolder() { NSWorkspace.shared.open(URL(fileURLWithPath: root + "/data/jobs")) }
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
