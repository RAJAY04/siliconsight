import Foundation

// Polls local Ollama and LM Studio servers. Read-only: nothing is proxied or intercepted.
final class LLMPoller {
    private let queue: DispatchQueue
    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 0.3
        c.timeoutIntervalForResource = 0.3
        return URLSession(configuration: c)
    }()
    private var ollama: [[String: Any]]?
    private var lmstudio: [[String: Any]]?

    /// `queue` is the sampler queue; results are stored on it so reads need no lock.
    init(queue: DispatchQueue) { self.queue = queue }

    var current: Any {
        if let m = ollama { return ["runtime": "ollama", "models": m, "tokensPerSec": NSNull()] }
        if let m = lmstudio { return ["runtime": "lmstudio", "models": m, "tokensPerSec": NSNull()] }
        return NSNull()
    }

    func poll() {
        fetch("http://127.0.0.1:11434/api/ps") { [weak self] json in
            self?.ollama = (json?["models"] as? [[String: Any]])?.map {
                ["name": $0["name"] as? String ?? "?", "sizeBytes": $0["size"] as? Int ?? NSNull(), "vramBytes": $0["size_vram"] as? Int ?? NSNull()]
            }
        }
        // /api/v0/models says which models are loaded; older LM Studio only has /v1/models (all downloaded models).
        fetch("http://127.0.0.1:1234/api/v0/models") { [weak self] json in
            if let list = json?["data"] as? [[String: Any]] {
                self?.lmstudio = list.filter { $0["state"] as? String == "loaded" }.map(Self.lmModel)
                return
            }
            self?.fetch("http://127.0.0.1:1234/v1/models") { json in
                self?.lmstudio = (json?["data"] as? [[String: Any]])?.map(Self.lmModel)
            }
        }
    }

    private static func lmModel(_ m: [String: Any]) -> [String: Any] {
        ["name": m["id"] as? String ?? "?", "sizeBytes": NSNull(), "vramBytes": NSNull()]
    }

    private func fetch(_ url: String, _ done: @escaping ([String: Any]?) -> Void) {
        session.dataTask(with: URL(string: url)!) { [queue] data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            let json = ok ? data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } : nil
            queue.async { done(json) }
        }.resume()
    }
}
