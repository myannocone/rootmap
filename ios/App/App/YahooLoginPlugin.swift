import UIKit
import WebKit
import Capacitor

@objc(YahooLoginPlugin)
public class YahooLoginPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "YahooLoginPlugin"
    public let jsName = "YahooLogin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise)
    ]

    private var activeRefresh: YahooSilentRefresh?

    @objc func login(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("Yahoo sign-in could not open.")
                return
            }
            let sheet = YahooLoginSheet()
            sheet.onFinish = { result in
                call.resolve(result)
            }
            sheet.onCancel = {
                call.reject("Yahoo sign-in was cancelled.")
            }
            let nav = UINavigationController(rootViewController: sheet)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }

    @objc func refresh(_ call: CAPPluginCall) {
        let raw = (call.getString("matchupUrl") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard var url = URL(string: raw), let host = url.host?.lowercased(), host.contains("yahoo") else {
            call.reject("A saved Yahoo matchup URL is required.")
            return
        }
        let week = YahooLinks.weekArgument(call)
        if !week.isEmpty {
            url = YahooLinks.applying(week: week, to: url)
        }
        DispatchQueue.main.async {
            guard let hostView = self.bridge?.viewController?.view else {
                call.reject("Yahoo refresh could not start.")
                return
            }
            let loader = YahooSilentRefresh()
            self.activeRefresh = loader
            loader.start(in: hostView, url: url) { [weak self] result in
                self?.activeRefresh = nil
                switch result {
                case .success(let payload):
                    call.resolve(payload)
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }
}

enum YahooLinks {
    static let home = URL(string: "https://football.fantasysports.yahoo.com/")!

    static let extractScript = """
    (function(){
      function clip(value, max) {
        var text = String(value || '');
        return text.length > max ? text.slice(0, max) : text;
      }
      var root = document.querySelector('#matchup-view, .matchup-content, [data-tst="matchup"], main') || document.body;
      var pageText = root && root.innerText ? root.innerText : (document.body ? document.body.innerText : '');
      var html = root && root.outerHTML ? root.outerHTML : (document.body ? document.body.innerHTML : '');
      var href = String(location.href || '');
      var leagueId = '';
      var teamId = '';
      var pathMatch = href.match(/\\/f1\\/(\\d+)(?:\\/(\\d+))?/);
      if (pathMatch) {
        leagueId = pathMatch[1] || '';
        teamId = pathMatch[2] || '';
      }
      if (!teamId) {
        var embedded = html.match(/"team_id"\\s*:\\s*"?(\\d+)"?/) || html.match(/teamId=(\\d+)/);
        if (embedded) teamId = embedded[1] || '';
      }
      return { href: href, leagueId: leagueId, teamId: teamId, pageText: clip(pageText, 180000), html: clip(html, 350000) };
    })();
    """

    static let findLeagueScript = """
    (function(){
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href || '';
        if (/football\\.fantasysports\\.yahoo\\.com\\/(?:\\d{4}\\/)?f1\\/\\d+/.test(href)) return href;
      }
      return '';
    })();
    """

    static func isLogin(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "login.yahoo.com" || host.hasSuffix(".login.yahoo.com")
    }

    static func hasSession(_ cookies: [HTTPCookie]) -> Bool {
        cookies.contains { cookie in
            let name = cookie.name
            return cookie.domain.lowercased().contains("yahoo.com") && (name == "Y" || name == "T")
        }
    }

    static func weekArgument(_ call: CAPPluginCall) -> String {
        if let text = call.getString("week")?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            return text
        }
        if let number = call.getInt("week"), number > 0 {
            return String(number)
        }
        return ""
    }

    static func leagueId(from url: URL?) -> String {
        capture(url, pattern: "/f1/(\\d+)")
    }

    static func teamId(from url: URL?) -> String {
        capture(url, pattern: "/f1/\\d+/(\\d+)(?:/|$)")
    }

    static func week(from url: URL?) -> String {
        guard let url else { return "" }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == "week" }?
            .value ?? ""
    }

    static func applying(week: String, to url: URL) -> URL {
        guard !week.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        var items = components.queryItems ?? []
        if let index = items.firstIndex(where: { $0.name == "week" }) {
            items[index].value = week
        } else {
            items.append(URLQueryItem(name: "week", value: week))
        }
        components.queryItems = items
        return components.url ?? url
    }

    static func matchupURL(leagueId: String, week: String, fallback: URL?) -> URL? {
        if leagueId.isEmpty { return fallback }
        if fallback?.path.contains("/matchup") == true, let fallback {
            return week.isEmpty ? fallback : applying(week: week, to: fallback)
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "football.fantasysports.yahoo.com"
        components.path = "/f1/\(leagueId)/matchup"
        if !week.isEmpty {
            components.queryItems = [URLQueryItem(name: "week", value: week)]
        }
        return components.url ?? fallback
    }

    static func payload(_ value: Any?, url: URL?) -> [String: Any] {
        let body = dictionary(value)
        let hrefText = string(body["href"])
        let href = url ?? URL(string: hrefText)
        let league = first(string(body["leagueId"]), leagueId(from: href))
        let team = first(string(body["teamId"]), teamId(from: href))
        let matchup = matchupURL(leagueId: league, week: week(from: href), fallback: href)?.absoluteString ?? (href?.absoluteString ?? "")
        return [
            "leagueId": league,
            "teamId": team,
            "matchupUrl": matchup,
            "pageText": clip(string(body["pageText"]), 180_000),
            "html": clip(string(body["html"]), 350_000)
        ]
    }

    private static func capture(_ url: URL?, pattern: String) -> String {
        guard let path = url?.path else { return "" }
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return "" }
        let range = NSRange(path.startIndex..., in: path)
        guard let match = regex.firstMatch(in: path, options: [], range: range),
              match.numberOfRanges > 1,
              let piece = Range(match.range(at: 1), in: path) else {
            return ""
        }
        return String(path[piece])
    }

    private static func dictionary(_ value: Any?) -> [String: Any] {
        if let typed = value as? [String: Any] { return typed }
        guard let typed = value as? NSDictionary else { return [:] }
        var body: [String: Any] = [:]
        for key in typed.allKeys {
            guard let name = key as? String, let item = typed.object(forKey: name) else { continue }
            body[name] = item
        }
        return body
    }

    private static func string(_ value: Any?) -> String {
        if let text = value as? String { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    private static func first(_ primary: String, _ fallback: String) -> String {
        primary.isEmpty ? fallback : primary
    }

    private static func clip(_ text: String, _ max: Int) -> String {
        text.count <= max ? text : String(text.prefix(max))
    }
}

final class YahooLoginSheet: UIViewController, WKNavigationDelegate, WKUIDelegate, UIAdaptivePresentationControllerDelegate {
    var onFinish: (([String: Any]) -> Void)?
    var onCancel: (() -> Void)?

    private var webView: WKWebView!
    private var useButton: UIBarButtonItem!
    private var pollTimer: Timer?
    private var finished = false
    private var capturing = false
    private var autoTriggered = false
    private var pushedMatchup = false
    private var awaitingMatchup = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let cancel = UIBarButtonItem(title: "Cancel", style: .plain, target: self, action: #selector(cancelTapped))
        useButton = UIBarButtonItem(title: "Use Session", style: .done, target: self, action: #selector(useTapped))
        useButton.isEnabled = false
        navigationItem.leftBarButtonItem = cancel
        navigationItem.rightBarButtonItem = useButton
        navigationItem.title = "Sign in to Yahoo"

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        webView.load(URLRequest(url: YahooLinks.home))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.presentationController?.delegate = self
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.refreshReadyState()
        }
        refreshReadyState()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        pollTimer?.invalidate()
        pollTimer = nil
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard !finished else { return }
        finished = true
        pollTimer?.invalidate()
        onCancel?()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if awaitingMatchup {
            awaitingMatchup = false
            if YahooLinks.isLogin(webView.url) {
                autoTriggered = false
                pushedMatchup = false
                refreshReadyState()
                return
            }
            extractAndFinish()
            return
        }
        refreshReadyState()
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

    private func refreshReadyState() {
        guard !finished else { return }
        let onLogin = YahooLinks.isLogin(webView.url)
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                let loggedIn = YahooLinks.hasSession(cookies) && !onLogin
                let leagueId = YahooLinks.leagueId(from: self.webView.url)
                self.useButton.isEnabled = loggedIn
                if onLogin {
                    self.navigationItem.title = "Sign in to Yahoo"
                } else if leagueId.isEmpty {
                    self.navigationItem.title = loggedIn ? "Choose your league" : "Sign in to Yahoo"
                } else {
                    self.navigationItem.title = "Yahoo connected"
                }
                if loggedIn && !leagueId.isEmpty && !self.autoTriggered {
                    self.autoTriggered = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        self.captureIfReady(automatic: true)
                    }
                }
            }
        }
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        finished = true
        pollTimer?.invalidate()
        let cancel = onCancel
        dismiss(animated: true) {
            cancel?()
        }
    }

    @objc private func useTapped() {
        captureIfReady(automatic: false)
    }

    private func captureIfReady(automatic: Bool) {
        guard !finished else { return }
        if YahooLinks.isLogin(webView.url) {
            autoTriggered = false
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        let leagueId = YahooLinks.leagueId(from: webView.url)
        if leagueId.isEmpty {
            if automatic { return }
            openFirstLeague()
            return
        }
        let onMatchup = webView.url?.path.contains("/matchup") == true
        if !onMatchup && !pushedMatchup {
            pushedMatchup = true
            awaitingMatchup = true
            if let matchup = YahooLinks.matchupURL(leagueId: leagueId, week: YahooLinks.week(from: webView.url), fallback: webView.url) {
                webView.load(URLRequest(url: matchup))
                return
            }
        }
        extractAndFinish()
    }

    private func openFirstLeague() {
        webView.evaluateJavaScript(YahooLinks.findLeagueScript) { [weak self] value, _ in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                let href = value as? String ?? ""
                guard let url = URL(string: href), !YahooLinks.leagueId(from: url).isEmpty else {
                    self.extractAndFinish()
                    return
                }
                let leagueId = YahooLinks.leagueId(from: url)
                self.pushedMatchup = true
                self.awaitingMatchup = true
                if let matchup = YahooLinks.matchupURL(leagueId: leagueId, week: YahooLinks.week(from: url), fallback: url) {
                    self.webView.load(URLRequest(url: matchup))
                } else {
                    self.extractAndFinish()
                }
            }
        }
    }

    private func extractAndFinish() {
        guard !finished, !capturing else { return }
        if YahooLinks.isLogin(webView.url) {
            autoTriggered = false
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        capturing = true
        webView.evaluateJavaScript(YahooLinks.extractScript) { [weak self] value, _ in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                self.finished = true
                self.pollTimer?.invalidate()
                let payload = YahooLinks.payload(value, url: self.webView.url)
                let finish = self.onFinish
                self.dismiss(animated: true) {
                    finish?(payload)
                }
            }
        }
    }
}

final class YahooSilentRefresh: NSObject, WKNavigationDelegate {
    private var webView: WKWebView?
    private var timeout: Timer?
    private var done = false
    private var completion: ((Result<[String: Any], Error>) -> Void)?

    func start(in host: UIView, url: URL, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        self.completion = completion
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: CGRect(x: -4000, y: -4000, width: 390, height: 844), configuration: config)
        webView.navigationDelegate = self
        webView.alpha = 0
        webView.isUserInteractionEnabled = false
        host.addSubview(webView)
        self.webView = webView
        webView.load(URLRequest(url: url))
        timeout = Timer.scheduledTimer(withTimeInterval: 28, repeats: false) { [weak self] _ in
            self?.fail("Yahoo refresh timed out.")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let main = navigationAction.targetFrame?.isMainFrame ?? true
        if main && YahooLinks.isLogin(navigationAction.request.url) {
            decisionHandler(.cancel)
            fail("SESSION_EXPIRED")
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if YahooLinks.isLogin(webView.url) {
            fail("SESSION_EXPIRED")
            return
        }
        webView.evaluateJavaScript(YahooLinks.extractScript) { [weak self] value, _ in
            DispatchQueue.main.async {
                guard let self, !self.done else { return }
                let payload = YahooLinks.payload(value, url: webView.url)
                self.succeed(payload)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        fail("Yahoo refresh failed.")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        fail("Yahoo refresh failed.")
    }

    private func succeed(_ payload: [String: Any]) {
        finish(Result<[String: Any], Error>.success(payload))
    }

    private func fail(_ message: String) {
        let error = NSError(domain: "YahooLogin", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        finish(Result<[String: Any], Error>.failure(error))
    }

    private func finish(_ result: Result<[String: Any], Error>) {
        guard !done else { return }
        done = true
        timeout?.invalidate()
        timeout = nil
        let callback = completion
        completion = nil
        webView?.navigationDelegate = nil
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        callback?(result)
    }
}
