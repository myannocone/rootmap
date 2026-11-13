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
      function clean(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim();
      }
      function isOppMark(value) {
        return /^(?:@|vs\\.?|at)\\s+[A-Za-z]{2,3}$/i.test(clean(value));
      }
      function slotToken(value) {
        var key = clean(value).toUpperCase();
        if (key === 'W/R/T' || key === 'WR/TE' || key === 'W/R') return 'FLEX';
        if (key === 'D/ST' || key === 'DST') return 'DEF';
        if (key === 'D') return 'IDP';
        if (/^(QB|RB|WR|TE|FLEX|K|DEF|DB|DL|LB|IDP)$/.test(key)) return key;
        return '';
      }
      function teamPos(value) {
        var match = clean(value).match(/^([A-Za-z]{2,3})\\s*[-–]\\s*([A-Za-z\\/]+)$/);
        if (!match) return null;
        return { nflTeam: match[1].toUpperCase(), position: slotToken(match[2]) || match[2].toUpperCase() };
      }
      function clockOf(value) {
        var text = clean(value).replace(/\\s+(?:@|vs\\.?|at)\\s+[A-Za-z]{2,3}\\b/ig, '').trim();
        if (/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|Final|Bye|Q[1-4]|OT|Halftime|Delayed|Postponed)\\b/i.test(text)) return text;
        return '';
      }
      function pointsOf(value) {
        var match = clean(value).match(/^(\\d+\\.\\d{1,2})$/);
        return match ? match[1] : '';
      }
      function splitName(value) {
        var text = clean(value);
        var glued = text.match(/^(.*[a-z.])([A-Za-z]{2,3})\\s*[-–]\\s*(QB|RB|WR|TE|K|DEF|FLEX|D\\/ST|W\\/R\\/T|DB|DL|LB)/i);
        if (glued && clean(glued[1]).length >= 2) {
          return { name: clean(glued[1]), nflTeam: glued[2].toUpperCase(), position: slotToken(glued[3]) || glued[3].toUpperCase() };
        }
        return { name: text.replace(/\\s*(?:@|vs\\.?|at)\\s+[A-Za-z]{2,3}.*$/, '').trim(), nflTeam: '', position: '' };
      }
      function pieces(node) {
        var out = [];
        if (!node) return out;
        var children = node.children || [];
        if (!children.length) {
          var only = clean(node.textContent || '');
          if (only && !isOppMark(only)) out.push(only);
          return out;
        }
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          var tag = String(child.tagName || '').toUpperCase();
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') continue;
          var value = clean(child.innerText || child.textContent || '');
          if (!value || isOppMark(value)) continue;
          if (child.children && child.children.length && value.length > 48) out = out.concat(pieces(child));
          else out.push(value);
        }
        return out;
      }
      function playerFrom(node) {
        if (!node) return null;
        var name = '';
        var nflTeam = '';
        var position = '';
        var anchors = node.querySelectorAll('a[href]');
        for (var i = 0; i < anchors.length; i++) {
          var href = anchors[i].href || '';
          if (!/\\/players?\\//i.test(href) && !/playerId=/i.test(href) && !/\\/athlete\\//i.test(href)) continue;
          var split = splitName(anchors[i].innerText || anchors[i].textContent || '');
          if (!split.name || slotToken(split.name) || teamPos(split.name) || isOppMark(split.name)) continue;
          name = split.name;
          nflTeam = split.nflTeam;
          position = split.position;
          break;
        }
        var parts = pieces(node);
        if (!name) {
          for (var n = 0; n < parts.length; n++) {
            if (slotToken(parts[n]) || teamPos(parts[n]) || pointsOf(parts[n]) || clockOf(parts[n]) || isOppMark(parts[n])) continue;
            if (/[A-Za-z]/.test(parts[n]) && parts[n].length >= 2 && parts[n].length < 40) {
              name = splitName(parts[n]).name;
              break;
            }
          }
        }
        if (!name || isOppMark(name) || /^(bench|starters|total|projected)$/i.test(name)) return null;
        var slot = '';
        var points = '';
        var gameClock = '';
        for (var p = 0; p < parts.length; p++) {
          var part = parts[p];
          if (isOppMark(part)) continue;
          var pos = teamPos(part);
          if (pos) {
            nflTeam = nflTeam || pos.nflTeam;
            position = position || pos.position;
            continue;
          }
          var asSlot = slotToken(part);
          if (asSlot) {
            slot = slot || asSlot;
            position = position || asSlot;
            continue;
          }
          var pts = pointsOf(part);
          if (pts) {
            points = pts;
            continue;
          }
          var clock = clockOf(part);
          if (clock) gameClock = clock;
        }
        return {
          name: name,
          nflTeam: nflTeam,
          position: position || slot || 'FLEX',
          slot: slot || position || 'FLEX',
          points: points,
          actualPoints: points,
          gameClock: gameClock || 'Scheduled'
        };
      }
      function harvest() {
        var mine = [];
        var opp = [];
        var tables = document.querySelectorAll('table');
        var singleTables = [];
        for (var t = 0; t < tables.length; t++) {
          var rows = tables[t].querySelectorAll('tr');
          var paired = [];
          var singles = [];
          var bench = false;
          for (var r = 0; r < rows.length; r++) {
            var rowText = clean(rows[r].innerText || '');
            if (/^bench\\b/i.test(rowText)) {
              bench = true;
              continue;
            }
            if (bench) continue;
            var cells = rows[r].children || [];
            var found = [];
            var rowSlot = '';
            for (var c = 0; c < cells.length; c++) {
              var cellText = clean(cells[c].innerText || '');
              if (/^bench\\b/i.test(cellText)) {
                bench = true;
                break;
              }
              if (isOppMark(cellText)) continue;
              var directSlot = slotToken(cellText);
              if (directSlot && cellText.length <= 8) rowSlot = directSlot;
              var player = playerFrom(cells[c]);
              if (player) found.push(player);
            }
            if (bench) continue;
            if (rowSlot) found.forEach(function(player) { player.slot = rowSlot; });
            if (found.length >= 2) paired.push(found);
            else if (found.length === 1) singles.push(found[0]);
          }
          paired.forEach(function(pair) {
            mine.push(pair[0]);
            opp.push(pair[1]);
          });
          if (!paired.length && singles.length) singleTables.push(singles);
        }
        if (!mine.length && singleTables.length) {
          mine = singleTables[0];
          if (singleTables.length > 1) opp = singleTables[1];
        }
        return { mine: mine.slice(0, 16), opp: opp.slice(0, 16) };
      }
      function recordOf(value) {
        var match = clean(value).match(/(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s*-\\s*(\\d{1,2})/);
        return match ? (match[1] + '-' + match[2] + '-' + match[3]) : '';
      }
      function rankOf(value) {
        var match = clean(value).match(/(\\d+)(?:st|nd|rd|th)/i);
        return match ? match[1] : '';
      }
      function scoreOf(value) {
        var matches = clean(value).match(/\\d+\\.\\d{1,2}/g) || [];
        return matches.length ? matches[matches.length - 1] : '';
      }
      function contextOf(link) {
        var node = link;
        for (var i = 0; i < 5 && node; i++) {
          var value = clean(node.innerText || '');
          if (recordOf(value)) return value;
          node = node.parentElement;
        }
        return clean(link.parentElement ? link.parentElement.innerText : '');
      }
      var href = String(location.href || '');
      var pathMatch = href.match(/\\/f1\\/(\\d+)(?:\\/(\\d+))?/);
      var leagueId = pathMatch ? (pathMatch[1] || '') : '';
      var teamId = pathMatch && pathMatch[2] ? pathMatch[2] : '';
      var teamLinks = [];
      var seenTeams = {};
      var anchors = document.querySelectorAll('a[href]');
      for (var a = 0; a < anchors.length; a++) {
        var teamHref = anchors[a].href || '';
        var teamMatch = teamHref.match(/\\/f1\\/(\\d+)\\/(\\d+)(?:\\/|$|\\?)/);
        if (!teamMatch) continue;
        var teamKey = teamMatch[1] + ':' + teamMatch[2];
        if (seenTeams[teamKey]) continue;
        seenTeams[teamKey] = true;
        var label = clean(anchors[a].innerText || '').replace(/\\d+\\s*-\\s*\\d+\\s*-\\s*\\d+.*/, '').trim();
        if (!label || label.length > 40 || slotToken(label)) continue;
        teamLinks.push({ leagueId: teamMatch[1], teamId: teamMatch[2], name: label, context: contextOf(anchors[a]) });
      }
      var mineLink = teamLinks.filter(function(link) { return teamId && link.teamId === teamId; })[0] || teamLinks[0] || null;
      var oppLink = teamLinks.filter(function(link) { return !mineLink || link.teamId !== mineLink.teamId; })[0] || null;
      if (!teamId && mineLink) teamId = mineLink.teamId;
      if (!leagueId && mineLink) leagueId = mineLink.leagueId;
      var title = clean(document.title || '');
      var titleParts = title.split(/\\s[-|–]\\s/).map(clean).filter(Boolean);
      var leagueName = '';
      for (var n = 0; n < titleParts.length; n++) {
        if (titleParts[n].length < 3 || titleParts[n].length > 48) continue;
        if (/yahoo|fantasy|football|matchup|week\\s+\\d+/i.test(titleParts[n])) continue;
        leagueName = titleParts[n];
        break;
      }
      var heading = document.querySelector('h1');
      if (!leagueName && heading) {
        var headingText = clean(heading.innerText || '');
        if (headingText && !/yahoo|matchup/i.test(headingText)) leagueName = headingText;
      }
      var rosters = harvest();
      function sideLine(link) {
        var context = link ? link.context : '';
        return {
          name: link ? link.name : '',
          record: recordOf(context),
          rank: rankOf(context),
          score: scoreOf(context)
        };
      }
      var mineSide = sideLine(mineLink);
      var oppSide = sideLine(oppLink);
      var lines = [];
      if (leagueName) lines.push('League: ' + leagueName);
      lines.push(mineSide.name || 'My Team');
      if (mineSide.record) lines.push(mineSide.rank ? (mineSide.record + ' | ' + mineSide.rank) : mineSide.record);
      if (mineSide.score) lines.push(mineSide.score);
      lines.push(oppSide.name || 'Opponent');
      if (oppSide.record) lines.push(oppSide.rank ? (oppSide.record + ' | ' + oppSide.rank) : oppSide.record);
      if (oppSide.score) lines.push(oppSide.score);
      lines.push('Starters');
      var count = Math.max(rosters.mine.length, rosters.opp.length);
      for (var i = 0; i < count; i++) {
        var minePlayer = rosters.mine[i];
        var oppPlayer = rosters.opp[i];
        if (minePlayer && !isOppMark(minePlayer.name)) {
          lines.push(minePlayer.name);
          if (minePlayer.nflTeam) lines.push(minePlayer.nflTeam + ' - ' + (minePlayer.position || minePlayer.slot));
          if (minePlayer.gameClock) lines.push(minePlayer.gameClock);
          if (minePlayer.points) lines.push(minePlayer.points);
        }
        lines.push((minePlayer && minePlayer.slot) || (oppPlayer && oppPlayer.slot) || 'FLEX');
        if (oppPlayer && !isOppMark(oppPlayer.name)) {
          if (oppPlayer.points) lines.push(oppPlayer.points);
          lines.push(oppPlayer.name);
          if (oppPlayer.nflTeam) lines.push(oppPlayer.nflTeam + ' - ' + (oppPlayer.position || oppPlayer.slot));
          if (oppPlayer.gameClock) lines.push(oppPlayer.gameClock);
        }
      }
      var lineup = {
        leagueName: leagueName,
        myTeamName: mineSide.name,
        oppTeamName: oppSide.name,
        myRecord: mineSide.record,
        oppRecord: oppSide.record,
        myRank: mineSide.rank,
        oppRank: oppSide.rank,
        myScore: mineSide.score,
        oppScore: oppSide.score,
        myStarters: rosters.mine,
        oppStarters: rosters.opp
      };
      return {
        href: href,
        leagueId: leagueId,
        teamId: teamId,
        pageText: clip(lines.join('\\n'), 180000),
        html: '',
        lineup: clip(JSON.stringify(lineup), 180000)
      };
    })();
    """

    static let listTeamsScript = """
    (function(){
      function clean(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim();
      }
      var seen = {};
      var teams = [];
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href || '';
        var match = href.match(/\\/f1\\/(\\d+)\\/(\\d+)(?:\\/|$|\\?)/);
        if (!match) continue;
        var key = match[1] + ':' + match[2];
        if (seen[key]) continue;
        seen[key] = true;
        var name = clean(links[i].innerText || links[i].textContent || '');
        name = name.replace(/\\d+\\s*-\\s*\\d+\\s*-\\s*\\d+.*/, '').trim();
        if (!name || name.length > 40) name = 'Team ' + match[2];
        teams.push({ leagueId: match[1], teamId: match[2], href: href, name: name });
      }
      return JSON.stringify(teams);
    })();
    """

    static let rowsReadyScript = """
    (function(){
      var links = document.querySelectorAll('a[href*="/players/"], a[href*="playerId="], a[href*="/athlete/"]');
      if (links.length >= 2) return true;
      var slots = 0;
      var nodes = document.querySelectorAll('td, span');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].children.length) continue;
        var text = String(nodes[i].textContent || '').replace(/\\s+/g, ' ').trim();
        if (/^(QB|RB|WR|TE|FLEX|K|DEF|W\\/R\\/T)$/i.test(text)) slots += 1;
        if (slots >= 2) return true;
      }
      return false;
    })();
    """

    static func isLeagueList(_ url: URL?) -> Bool {
        guard let url, !isLogin(url) else { return false }
        let host = url.host?.lowercased() ?? ""
        guard host.contains("fantasysports.yahoo.com") else { return false }
        return leagueId(from: url).isEmpty
    }

    static func captureWhenReady(
        webView: WKWebView,
        attempt: Int,
        stillActive: @escaping () -> Bool,
        completion: @escaping (Any?) -> Void
    ) {
        let delay: TimeInterval = attempt == 0 ? 1.5 : 0.45
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak webView] in
            guard stillActive(), let webView else { return }
            webView.evaluateJavaScript(rowsReadyScript) { ready, _ in
                DispatchQueue.main.async {
                    guard stillActive() else { return }
                    let populated = (ready as? Bool) ?? (ready as? NSNumber)?.boolValue ?? false
                    if populated || attempt >= 5 {
                        webView.evaluateJavaScript(extractScript) { value, _ in
                            DispatchQueue.main.async {
                                guard stillActive() else { return }
                                completion(value)
                            }
                        }
                    } else {
                        captureWhenReady(webView: webView, attempt: attempt + 1, stillActive: stillActive, completion: completion)
                    }
                }
            }
        }
    }

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
            "html": clip(string(body["html"]), 350_000),
            "lineup": clip(string(body["lineup"]), 180_000)
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
    private var captureQueued = false
    private var pushedMatchup = false
    private var awaitingMatchup = false
    private var awaitingChoice = false
    private var listScanInFlight = false
    private var listScanAt: Date?
    private var pendingLeagueId = ""
    private var pendingTeamId = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let cancel = UIBarButtonItem(title: "Cancel", style: .plain, target: self, action: #selector(cancelTapped))
        useButton = UIBarButtonItem(title: "Use Session", style: .done, target: self, action: #selector(useTapped))
        useButton.isEnabled = false
        navigationItem.leftBarButtonItem = cancel
        navigationItem.rightBarButtonItem = useButton
        navigationItem.title = "Sign in to Yahoo"

        let banner = UIView()
        banner.translatesAutoresizingMaskIntoConstraints = false
        banner.backgroundColor = UIColor(red: 88.0 / 255.0, green: 28.0 / 255.0, blue: 135.0 / 255.0, alpha: 1)
        let instructions = UILabel()
        instructions.translatesAutoresizingMaskIntoConstraints = false
        instructions.text = "1. Sign in to Yahoo  2. Tap your team/matchup — RootMap will auto-import it (or tap Use Session)."
        instructions.numberOfLines = 0
        instructions.font = .systemFont(ofSize: 13, weight: .semibold)
        instructions.textColor = .white
        instructions.textAlignment = .center
        banner.addSubview(instructions)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(banner)
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            banner.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            banner.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            banner.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            instructions.topAnchor.constraint(equalTo: banner.topAnchor, constant: 8),
            instructions.bottomAnchor.constraint(equalTo: banner.bottomAnchor, constant: -8),
            instructions.leadingAnchor.constraint(equalTo: banner.leadingAnchor, constant: 12),
            instructions.trailingAnchor.constraint(equalTo: banner.trailingAnchor, constant: -12),
            webView.topAnchor.constraint(equalTo: banner.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
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
                pushedMatchup = false
                refreshReadyState()
                return
            }
            scheduleCapture()
            return
        }
        refreshReadyState()
        if YahooLinks.isLogin(webView.url) { return }
        if YahooLinks.isLeagueList(webView.url) {
            maybeScanList()
            return
        }
        if awaitingChoice {
            awaitingChoice = false
            pendingLeagueId = YahooLinks.leagueId(from: webView.url)
            pendingTeamId = YahooLinks.teamId(from: webView.url)
        }
        continueMatchup()
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
                if self.awaitingChoice && YahooLinks.isLeagueList(self.webView.url) {
                    self.navigationItem.title = "Tap your team"
                } else if onLogin {
                    self.navigationItem.title = "Sign in to Yahoo"
                } else if leagueId.isEmpty {
                    self.navigationItem.title = loggedIn ? "Choose your league" : "Sign in to Yahoo"
                } else {
                    self.navigationItem.title = "Yahoo connected"
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
        guard !finished else { return }
        if YahooLinks.isLogin(webView.url) {
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        if YahooLinks.isLeagueList(webView.url) {
            if awaitingChoice {
                navigationItem.title = "Tap your team"
                return
            }
            maybeScanList()
            return
        }
        continueMatchup()
    }

    private func maybeScanList() {
        guard !finished, !listScanInFlight, !awaitingChoice, YahooLinks.isLeagueList(webView.url) else { return }
        if let listScanAt, Date().timeIntervalSince(listScanAt) < 1.2 { return }
        listScanInFlight = true
        webView.evaluateJavaScript(YahooLinks.listTeamsScript) { [weak self] value, _ in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                self.listScanInFlight = false
                self.listScanAt = Date()
                guard YahooLinks.isLeagueList(self.webView.url) else { return }
                let teams = self.teams(from: value)
                if teams.count > 1 {
                    self.awaitingChoice = true
                    self.navigationItem.title = "Tap your team"
                    return
                }
                if let only = teams.first {
                    self.openTeam(only["leagueId"] ?? "", only["teamId"] ?? "")
                }
            }
        }
    }

    private func teams(from value: Any?) -> [[String: String]] {
        let raw = value as? String ?? ""
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return parsed.compactMap { item in
            let leagueId = item["leagueId"] as? String ?? ""
            let teamId = item["teamId"] as? String ?? ""
            if leagueId.isEmpty || teamId.isEmpty { return nil }
            return ["leagueId": leagueId, "teamId": teamId, "name": item["name"] as? String ?? ""]
        }
    }

    private func openTeam(_ leagueId: String, _ teamId: String) {
        guard !finished, !leagueId.isEmpty else { return }
        pendingLeagueId = leagueId
        pendingTeamId = teamId
        pushedMatchup = true
        awaitingMatchup = true
        let fallback = URL(string: "https://football.fantasysports.yahoo.com/f1/\(leagueId)/\(teamId)")
        if let matchup = YahooLinks.matchupURL(leagueId: leagueId, week: YahooLinks.week(from: webView.url), fallback: fallback) {
            webView.load(URLRequest(url: matchup))
        }
    }

    private func continueMatchup() {
        guard !finished, !capturing else { return }
        if YahooLinks.isLogin(webView.url) {
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        let leagueId = YahooLinks.leagueId(from: webView.url)
        if leagueId.isEmpty {
            maybeScanList()
            return
        }
        if pendingLeagueId.isEmpty { pendingLeagueId = leagueId }
        if pendingTeamId.isEmpty { pendingTeamId = YahooLinks.teamId(from: webView.url) }
        let onMatchup = webView.url?.path.contains("/matchup") == true
        if !onMatchup && !pushedMatchup {
            openTeam(leagueId, pendingTeamId)
            return
        }
        scheduleCapture()
    }

    private func scheduleCapture() {
        guard !finished, !capturing, !captureQueued else { return }
        captureQueued = true
        YahooLinks.captureWhenReady(webView: webView, attempt: 0, stillActive: { [weak self] in
            self?.finished == false
        }) { [weak self] value in
            self?.finishWith(value)
        }
    }

    private func finishWith(_ value: Any?) {
        guard !finished, !capturing else { return }
        if YahooLinks.isLogin(webView.url) {
            captureQueued = false
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        capturing = true
        finished = true
        pollTimer?.invalidate()
        var payload = YahooLinks.payload(value, url: webView.url)
        if ((payload["leagueId"] as? String) ?? "").isEmpty && !pendingLeagueId.isEmpty {
            payload["leagueId"] = pendingLeagueId
        }
        if ((payload["teamId"] as? String) ?? "").isEmpty && !pendingTeamId.isEmpty {
            payload["teamId"] = pendingTeamId
        }
        let finish = onFinish
        dismiss(animated: true) {
            finish?(payload)
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
        YahooLinks.captureWhenReady(webView: webView, attempt: 0, stillActive: { [weak self] in
            self?.done == false
        }) { [weak self] value in
            guard let self, !self.done else { return }
            self.succeed(YahooLinks.payload(value, url: webView.url))
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
