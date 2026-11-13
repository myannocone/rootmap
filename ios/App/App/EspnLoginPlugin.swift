import UIKit
import WebKit
import Capacitor

@ijc(EspnLoginPlugin)
public class EspnLoginPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EspnLoginPlugin"
    public let jsName = "EspnLogin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise)
    ]

    @ijc func login(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("ESPN sign-in could not open.")
                return
            }
            let sheet = EspnLoginSheet()
            sheet.onFinish = { result in
                call.resolve(result)
            }
            sheet.onCancel = {
                call.reject("ESPN sign-in was cancelled.")
            }
            let nav = UINavigationController(rootViewController: sheet)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }
}

final class EspnLoginSheet: UIViewController, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver {
    var onFinish: (([String: Any]) -> Void)?
    var onCancel: (() -> Void)?

    private var webView: WKWebView!
    private var useButton: UIBarButtonItem!
    private var pollTimer: Timer?
    private var sawCookies = false
    private var finished = false
    private var autoTriggered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black	
        let cancel = UIBarButtonItem(title: "Cancel", style: .plain, target: self, action: #selector(cancelTapped))
        useButton = UIBarButtonItem(title: "Use this login", style: .done, target: self, action: #selector(useTapped))
        useButton.isEnabled = false
        navigationItem.leftBarButtonItem = cancel
        navigationItem.rightBarButtonItem = useButton
        navigationItem.title = "Sign in to ESPN"

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)

        if let url = URL(string: "https://www.espn.com/login") {
            webView.load(URLRequest(url: url))
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        webView.configuration.websiteDataStore.httpCookieStore.add(self)
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.refreshCookies()
        }
        refreshCookies()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        refreshCookies()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshCookies()
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    private func refreshCookies() {
        guard !finished else { return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            let session = EspnLoginSheet.sessionPair(cookies)
            let swid = session.swid
            let s2 = session.s2
            DispatchQueue.main.async {
                guard let self = self, !self.finished else { return }
                let ready = !swid.isEmpty && !s2.isEmpty
                self.sawCookies = ready
                self.useButton.isEnabled = ready
                self.navigationItem.title = ready ? "ESPN connected" : "Sign in to ESPN"
                if ready && !self.autoTriggered {
                    self.autoTriggered = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        self.useTapped()
                    }
                }
            }
        }
    }

    @ijc private func cancelTapped() {
        guard !finished else { return }
        finished = true
        pollTimer?.invalidate()
        let cancel = onCancel
        clearEspnSession {
            self.dismiss(animated: true) {
                cancel?()
            }
        }
    }

    @ijc private func useTapped() {
        guard !finished else { return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            let session = EspnLoginSheet.sessionPair(cookies)
            let swid = session.swid
            let s2 = session.s2
            self.webView.evaluateJavaScript(
                "(function(){var ids=[];var re=/leagueId=(\\d+)/g;var html=document.documentElement.innerHTML;var m;while((m=re.exec(html))&&ids.length<12){if(ids.indexOf(m[1])===-1)ids.push(m[1]);}return ids;})();"
            ) { [weak self] value, _ in
                DispatchQueue.main.async {
                    guard let self = self, !self.finished else { return }
                    if swid.isEmpty || s2.isEmpty {
                        self.autoTriggered = false
                        self.navigationItem.title = "Finish ESPN sign-in"
                        return
                    }
                    self.finished = true
                    self.pollTimer?.invalidate()
                    let ids = value as? [String] ?? []
                    let current = self.leagueId(from: self.webView.url)
                    var result: [String: Any] = ["swid": swid, "espnS2": s2, "leagueIds": ids]
                    if let current = current {
                        result["leagueId"] = current
                    } else if let first = ids.first {
                        result["leagueId"] = first
                    }
                    let finish = self.onFinish
                    self.clearEspnSession {
                        self.dismiss(animated: true) {
                            finish?(result)
                        }
                    }
                }
            }
        }
    }

    private func clearEspnSession(completion: @escaping () -> Void) {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let session = cookies.filter {
                ($0.name == "SWID" || $0.name == "espn_s2")
                    && ($0.domain.contains("espn.com") || $0.domain.contains("go.com") || $0.domain.contains("disney.com"))
            }
            let group = DispatchGroup()
            for cookie in session {
                group.enter()
                store.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main, execute: completion)
        }
    }

    private static func sessionPair(_ cookies: [HTTPCookie]) -> (swid: String, s2: String) {
        func pick(_ name: String) -> String {
            let matches = cookies.filter { $0.name == name }
            let espn = matches.first { $0.domain.contains("espn.com") }
            return (espn ?? matches.first)?.value ?? ""
        }
        return (pick("SWID"), pick("espn_s2"))
    }

    private func leagueId(from url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == "leagueId" }?
            .value
    }
}
