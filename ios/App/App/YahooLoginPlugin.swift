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
        let matchupRaw = (call.getString("matchupUrl") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let week = YahooLinks.weekArgument(call)
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("Yahoo sign-in could not open.")
                return
            }
            let sheet = YahooLoginSheet()
            if let start = URL(string: matchupRaw), (start.host ?? "").lowercased().contains("yahoo") {
                sheet.startURL = week.isEmpty ? start : YahooLinks.applying(week: week, to: start)
            } else if !week.isEmpty {
                sheet.preferredWeek = week
            }
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
    static let home = URL(string: "https://football.fantasysports.yahoo.com/f1")!

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
        if (key === 'DEF' || key === 'D/ST' || key === 'DST') return 'D/ST';
        if (key === 'D' || key === 'DB' || key === 'DL' || key === 'LB') return 'IDP';
        if (/^(QB|RB|WR|TE|FLEX|K|D\\/ST|IDP)$/.test(key)) return key;
        return '';
      }
      function isGenericName(value) {
        return /^(my team|league|matchup|players|standings|home|fantasy|yahoo|mail|inbox|account|my account|sign in|sign out|settings|news|profile|notifications?)$/i.test(clean(value));
      }
      function isHeaderLabel(value) {
        return /^(stats|player|proj|pts|projected|points|pos)$/i.test(clean(value));
      }
      function isBenchStop(value) {
        var key = clean(value).toUpperCase();
        return key === 'BN' || key === 'IR' || key === 'IL' || key === 'INJURED RESERVE' || /^BENCH\\b/.test(key);
      }
      function isStatBlurb(value) {
        return /\\d/.test(value) && /\\b(rush|rec|pass|yds|yards|td|int|sack|tgt|att)\\b/i.test(value);
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
        var text = clean(value);
        var labeled = text.match(/^(?:proj(?:ected)?\\s+)?(\\d+\\.\\d{1,2}|\\d+)(?:\\s+proj(?:ected)?)?$/i);
        if (labeled) return labeled[1];
        var match = text.match(/^(\\d+\\.\\d{1,2})$/);
        return match ? match[1] : '';
      }
      function attachScores(player, slots) {
        if (!player || !slots) return player;
        // Top score slot is actual. Bottom score slot is projected.
        // A dash is unplayed (null). 0.00 stays 0. Projection never overwrites actual.
        var actual = slots.actual;
        var proj = slots.proj;
        if (Array.isArray(slots)) {
          var nums = slots.map(function(item) { return parseFloat(item); }).filter(function(n) { return isFinite(n); });
          if (nums.length >= 2) {
            actual = String(nums[0]);
            proj = String(nums[1]);
          } else if (nums.length === 1) {
            var clock = clean(player.gameClock || '');
            if (/^(Final|Q[1-4]|OT|Halftime)\\b/i.test(clock)) actual = String(nums[0]);
            else proj = String(nums[0]);
          }
        }
        if (proj != null && proj !== '') {
          player.projPoints = String(proj);
          player.projectedPoints = player.projPoints;
        }
        if (actual === '') {
          player.points = '';
          player.actualPoints = '';
          player.scoreSlotSeen = true;
        } else if (actual != null && actual !== '') {
          player.points = String(actual);
          player.actualPoints = player.points;
          player.scoreSlotSeen = true;
        } else if (proj != null && proj !== '') {
          player.scoreSlotSeen = true;
        }
        return player;
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
      function playerLink(node) {
        return node.querySelector('a[href*="/nfl/players/"], .ysf-player-name a, a.ysf-player-name');
      }
      function anchorName(anchor) {
        var parts = [];
        var kids = anchor.childNodes || [];
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].nodeType === 3) {
            var bit = clean(kids[i].textContent || '');
            if (bit) parts.push(bit);
          }
        }
        var name = clean(parts.join(' ')) || clean(anchor.textContent || '');
        var glued = name.match(/^(.*[a-z.])([A-Z])$/);
        if (glued && glued[1].length >= 2) name = clean(glued[1]);
        return name;
      }
      function playerFrom(node) {
        if (!node) return null;
        var anchor = playerLink(node);
        if (!anchor) return null;
        var split = splitName(anchorName(anchor));
        var name = split.name;
        var nflTeam = split.nflTeam;
        var position = split.position;
        if (!name || isGenericName(name) || isHeaderLabel(name) || isOppMark(name) || isStatBlurb(name) || slotToken(name)) return null;
        var parts = pieces(node).filter(function(part) { return !isStatBlurb(part) && !isHeaderLabel(part); });
        var slot = '';
        var points = '';
        var projPoints = '';
        var gameClock = '';
        var seenFloats = [];
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
            seenFloats.push(pts);
            continue;
          }
          var clock = clockOf(part);
          if (clock) gameClock = clock;
        }
        if (seenFloats.length >= 2) {
          // Document order inside a cell follows the stack: top actual, bottom proj.
          points = seenFloats[0];
          projPoints = seenFloats[1];
        } else if (seenFloats.length === 1) {
          if (/^(Final|Q[1-4]|OT|Halftime)\\b/i.test(gameClock)) points = seenFloats[0];
          else projPoints = seenFloats[0];
        }
        return {
          name: name,
          nflTeam: nflTeam,
          position: position || slot || '',
          slot: slot || position || '',
          points: points,
          actualPoints: points,
          projPoints: projPoints,
          projectedPoints: projPoints,
          gameClock: gameClock || 'Scheduled'
        };
      }
      function scoreTokenText(value) {
        var text = clean(value);
        if (/^[-–—]$/.test(text)) return { dash: true, value: '' };
        var labeled = text.match(/^(?:proj(?:ected)?\\s+)?(\\d+\\.\\d{1,2})(?:\\s+proj(?:ected)?)?$/i);
        if (!labeled) return null;
        return { dash: false, value: labeled[1], projLabel: /proj/i.test(text) };
      }
      function isProjElement(node) {
        var cls = String((node && node.className) || '');
        var label = '';
        try {
          label = (node && node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title') || '')) || '';
        } catch (err) {}
        // Only the score node itself. A wrapper around both numbers must not mark the actual slot as proj.
        return /proj/i.test(cls) || /proj/i.test(label);
      }
      function scoreSlotsFromCells(cellList) {
        var entries = [];
        var seen = {};
        function pushEntry(text, top, proj) {
          var token = scoreTokenText(text);
          if (!token) return;
          var key = Math.round(top) + ':' + (token.dash ? '-' : token.value) + ':' + (proj ? 'p' : 'a');
          if (seen[key]) return;
          seen[key] = true;
          entries.push({
            dash: token.dash,
            value: token.value,
            top: top,
            proj: Boolean(proj || token.projLabel)
          });
        }
        for (var i = 0; i < cellList.length; i++) {
          var cell = cellList[i];
          if (!cell || playerLink(cell)) continue;
          var cellText = clean(cell.innerText || cell.textContent || '');
          if (!cellText || isStatBlurb(cellText) || isHeaderLabel(cellText)) continue;
          var nodes = cell.querySelectorAll ? cell.querySelectorAll('span, div, b, strong, em, p') : [];
          var found = false;
          for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            var nestedScore = false;
            if (node.children && node.children.length) {
              for (var c = 0; c < node.children.length; c++) {
                if (scoreTokenText(node.children[c].textContent || '')) nestedScore = true;
              }
            }
            if (nestedScore) continue;
            var nodeText = clean(node.textContent || '');
            if (!scoreTokenText(nodeText)) continue;
            var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { top: 0, width: 1, height: 1 };
            if (rect.width === 0 && rect.height === 0) continue;
            pushEntry(nodeText, rect.top || 0, isProjElement(node));
            found = true;
          }
          if (!found) {
            var base = 0;
            try { base = cell.getBoundingClientRect().top || 0; } catch (err2) {}
            var lines = String(cell.innerText || cell.textContent || '').split(/\\n/);
            for (var li = 0; li < lines.length; li++) {
              if (!scoreTokenText(lines[li])) continue;
              pushEntry(lines[li], base + (li * 20), /proj/i.test(lines[li]));
            }
          }
        }
        if (!entries.length) return null;
        entries.sort(function(a, b) { return a.top - b.top; });
        var projEntry = null;
        for (var p = 0; p < entries.length; p++) {
          if (entries[p].proj && !entries[p].dash) { projEntry = entries[p]; break; }
        }
        var stack = entries.filter(function(entry) { return entry !== projEntry; });
        var actual = null;
        var proj = projEntry ? projEntry.value : null;
        if (stack.length) actual = stack[0].dash ? '' : stack[0].value;
        if (proj == null && stack.length >= 2 && !stack[1].dash) proj = stack[1].value;
        return { actual: actual, proj: proj };
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
            if (isBenchStop(rowText)) {
              bench = true;
              continue;
            }
            if (bench) continue;
            var cells = rows[r].children || [];
            var cellList = [];
            for (var ci = 0; ci < cells.length; ci++) cellList.push(cells[ci]);
            var found = [];
            var foundCells = [];
            var rowSlot = '';
            var headerCells = 0;
            var labeledCells = 0;
            for (var c = 0; c < cellList.length; c++) {
              var cellText = clean(cellList[c].innerText || '');
              if (!cellText || isOppMark(cellText)) continue;
              if (isBenchStop(cellText)) {
                bench = true;
                break;
              }
              labeledCells += 1;
              if (isHeaderLabel(cellText)) {
                headerCells += 1;
                continue;
              }
              if (isStatBlurb(cellText)) continue;
              var directSlot = slotToken(cellText);
              if (directSlot && cellText.length <= 8) {
                rowSlot = directSlot;
                continue;
              }
              var player = playerFrom(cellList[c]);
              if (player) {
                found.push(player);
                foundCells.push(c);
              }
            }
            if (bench || (labeledCells > 0 && headerCells === labeledCells)) continue;
            if (rowSlot) {
              found.forEach(function(player) {
                player.slot = rowSlot;
                if (!player.position || player.position === 'FLEX') player.position = rowSlot;
              });
            }
            if (found.length >= 2) {
              // Points/proj live in sibling cells. Yahoo order is usually:
              // [Mine player] [mine floats] [slot] [opp floats] [Opp player]
              // Splitting at the opp player cell sweeps opp floats into the left side.
              var leftIdx = foundCells[0];
              var rightIdx = foundCells[1];
              var splitAt = Math.floor((leftIdx + rightIdx) / 2) + 1;
              for (var si = leftIdx + 1; si < rightIdx; si++) {
                var splitText = clean(cellList[si].innerText || '');
                if (slotToken(splitText) && splitText.length <= 8) {
                  splitAt = si;
                  break;
                }
              }
              var leftSlots = scoreSlotsFromCells(cellList.slice(0, splitAt));
              var rightSlots = scoreSlotsFromCells(cellList.slice(splitAt));
              // Prefer row-level proj/actual cells over any float glued inside the name cell.
              // Each column's top slot is actual and its bottom slot is projected.
              if (leftSlots) attachScores(found[0], leftSlots);
              if (rightSlots) attachScores(found[1], rightSlots);
              paired.push(found);
            } else if (found.length === 1) {
              var soloSlots = scoreSlotsFromCells(cellList);
              if (soloSlots) attachScores(found[0], soloSlots);
              singles.push(found[0]);
            }
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
      function readableName(value) {
        var text = clean(value).replace(/\\d+\\s*-\\s*\\d+\\s*-\\s*\\d+.*/, '').trim();
        if (!text || text.length > 80 || isGenericName(text) || slotToken(text) || isHeaderLabel(text)) return '';
        if (/^league\\s*\\d+$/i.test(text)) return '';
        return text;
      }
      function leagueTitleFromJson() {
        var found = '';
        function consider(name, key) {
          if (found) return;
          var text = readableName(name);
          if (!text) return;
          var keyText = String(key || '');
          if (leagueId && keyText) {
            var matchesId = keyText === String(leagueId)
              || keyText.indexOf('.l.' + leagueId) !== -1
              || keyText.indexOf('/f1/' + leagueId) !== -1;
            if (!matchesId) return;
          }
          found = text;
        }
        function walk(value, depth) {
          if (found || !value || typeof value !== 'object' || depth > 8) return;
          if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) walk(value[i], depth + 1);
            return;
          }
          var key = value.league_key || value.leagueKey || value.league_id || value.leagueId || '';
          var named = value.league_name || value.leagueName || '';
          if (!named && typeof value.name === 'string' && !value.team_key && !value.teamKey && (value.num_teams != null || value.scoring_type || value.league_type || value.current_week != null)) {
            named = value.name;
          }
          if (named && key) consider(named, key);
          var keys = Object.keys(value);
          for (var k = 0; k < keys.length; k++) {
            var childKey = keys[k];
            if (childKey === 'parent' || childKey === 'parentNode' || childKey === 'ownerDocument') continue;
            try { walk(value[childKey], depth + 1); } catch (err) {}
          }
        }
        try { if (window.ydb) walk(window.ydb, 0); } catch (err) {}
        try { if (window.App && App.main) walk(App.main, 0); } catch (err) {}
        try { if (window.__NEXT_DATA__) walk(window.__NEXT_DATA__, 0); } catch (err) {}
        try {
          var scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
          for (var s = 0; s < scripts.length && !found; s++) {
            var raw = scripts[s].textContent || '';
            if (raw.indexOf('league_key') === -1 && raw.indexOf('.l.') === -1) continue;
            var re = /"league_key"\\s*:\\s*"(\\d+\\.l\\.\\d+)"/g;
            var match;
            while ((match = re.exec(raw)) && !found) {
              var slice = raw.slice(Math.max(0, match.index - 500), match.index + 800);
              var nameMatch = slice.match(/"name"\\s*:\\s*"([^"\\\\]{2,60})"/);
              if (nameMatch) consider(nameMatch[1], match[1]);
            }
          }
        } catch (err2) {}
        return found;
      }
      function leagueTitleFromDom() {
        var links = document.querySelectorAll('a[href*="/f1/"], [class*="breadcrumb"] a, [class*="Breadcrumb"] a, nav a, a.Navmain-title, #league-name');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].href || links[i].getAttribute('href') || '';
          var home = String(href).match(/\\/f1\\/(\\d+)\\/?(?:$|[?#])/);
          if (!home) continue;
          if (leagueId && home[1] !== String(leagueId)) continue;
          var text = readableName(links[i].innerText || links[i].textContent || links[i].getAttribute('aria-label') || links[i].getAttribute('title') || '');
          if (text) return text;
        }
        return '';
      }
      function realLeagueName() {
        var fromJson = leagueTitleFromJson();
        if (fromJson) return fromJson;
        var fromHome = leagueTitleFromDom();
        if (fromHome) return fromHome;
        var nodes = document.querySelectorAll(
          'h1, h2, h3, [class*="league-name"], [class*="LeagueName"], .Navmain-title, #league-name, [data-tst="league-name"], a[href*="/f1/"][class*="league"]'
        );
        for (var i = 0; i < nodes.length; i++) {
          var text = readableName(nodes[i].innerText || nodes[i].textContent || '');
          if (!text || /yahoo|fantasy football|week\\s+\\d+|matchup|standings|players|mail|inbox|account|settings|news|profile/i.test(text)) continue;
          return text;
        }
        var meta = document.querySelector('meta[property="og:title"], meta[name="title"]');
        if (meta && meta.content) {
          var metaParts = clean(meta.content).split(/\\s[-|–]\\s/).map(clean).filter(Boolean);
          for (var m = 0; m < metaParts.length; m++) {
            var metaPart = readableName(metaParts[m]);
            if (metaPart && !/yahoo|fantasy|football|week\\s+\\d+/i.test(metaPart)) return metaPart;
          }
        }
        var title = clean(document.title || '');
        var titleParts = title.split(/\\s[-|–]\\s/).map(clean).filter(Boolean);
        for (var n = 0; n < titleParts.length; n++) {
          var part = readableName(titleParts[n]);
          if (part && !/yahoo|fantasy|football|week\\s+\\d+/i.test(part)) return part;
        }
        return '';
      }
      function emptySide() {
        return { name: '', record: '', rank: '', score: '', proj: '', winOdds: '', logo: '', leagueId: '', teamId: '' };
      }
      function enrichSide(hit) {
        if (!hit || !hit.node) return emptySide();
        var container = hit.node;
        for (var i = 0; i < 6 && container.parentElement; i++) {
          var parent = container.parentElement;
          var otherTeam = false;
          var links = parent.querySelectorAll('a[href*="/f1/"]');
          for (var j = 0; j < links.length; j++) {
            var om = (links[j].href || '').match(/\\/f1\\/(\\d+)\\/(\\d+)/);
            if (om && String(om[2]) !== String(hit.teamId)) { otherTeam = true; break; }
          }
          var ownText = clean(container.innerText || '');
          if (otherTeam) {
            if (recordOf(ownText) || scoreOf(ownText)) break;
            break;
          }
          container = parent;
          var parentText = clean(parent.innerText || '');
          if (recordOf(parentText) && scoreOf(parentText)) break;
        }
        var text = clean(container.innerText || '');
        var logo = '';
        var img = container.querySelector('img[src]');
        if (img && img.src && !/spacer|blank|pixel/i.test(img.src)) logo = img.src;
        var oddsMatch = text.match(/(\\d{1,3})\\s*%/);
        var floats = text.match(/\\d+\\.\\d{1,2}/g) || [];
        // Header stack matches player rows: top/first number is the live total.
        var score = floats.length ? floats[0] : '';
        var proj = floats.length >= 2 ? floats[1] : '';
        var projLabeled = text.match(/proj(?:ected)?\\s*(\\d+\\.\\d{1,2})/i)
          || text.match(/(\\d+\\.\\d{1,2})\\s*proj/i);
        if (projLabeled) proj = projLabeled[1];
        var resolved = hit.name || nameFromColumn(container, hit.node);
        return {
          name: resolved || '',
          record: recordOf(text),
          rank: rankOf(text),
          score: score,
          proj: proj,
          winOdds: oddsMatch ? oddsMatch[1] : '',
          logo: logo,
          leagueId: hit.leagueId || '',
          teamId: hit.teamId || ''
        };
      }
      function teamAnchorName(link) {
        if (!link) return '';
        var img = link.querySelector ? link.querySelector('img') : null;
        var imgName = img ? (img.getAttribute('alt') || img.getAttribute('title') || '') : '';
        return readableName(link.innerText || link.textContent || '')
          || readableName(link.getAttribute('title') || '')
          || readableName(link.getAttribute('aria-label') || '')
          || readableName(link.getAttribute('data-name') || '')
          || readableName(imgName);
      }
      function nameFromColumn(container, link) {
        var named = teamAnchorName(link);
        if (named) return named;
        if (!container) return '';
        var lines = String(container.innerText || '').split(/\\n/).map(clean).filter(Boolean);
        for (var i = 0; i < lines.length; i++) {
          var line = readableName(lines[i]);
          if (line && !recordOf(line)) return line;
        }
        return readableName(container.innerText || '');
      }
      function columnOwned(link) {
        var node = link;
        for (var i = 0; i < 6 && node; i++) {
          var cls = String(node.className || '');
          var flag = '';
          try {
            flag = node.getAttribute
              ? (node.getAttribute('data-owner') || node.getAttribute('data-mine') || node.getAttribute('data-self') || node.getAttribute('data-is-own') || '')
              : '';
          } catch (err) {}
          if (flag && flag !== '0' && flag !== 'false') return true;
          if (/(\\bmy[-_ ]?team\\b|\\bowner\\b|\\bis-own|\\bown-team|\\blogged-in\\b)/i.test(cls)) return true;
          node = node.parentElement;
        }
        return false;
      }
      function scoreboardSides() {
        var teams = [];
        var seen = {};
        var anchors = document.querySelectorAll('a[href*="/f1/"]');
        for (var i = 0; i < anchors.length; i++) {
          var link = anchors[i];
          var match = (link.href || '').match(/\\/f1\\/(\\d+)\\/(\\d+)/);
          if (!match) continue;
          var rect = link.getBoundingClientRect();
          if (!rect.width || rect.top > 460) continue;
          var key = match[1] + ':' + match[2];
          if (seen[key]) continue;
          var name = teamAnchorName(link);
          // Keep logo-only team links so each column stays bound to its own team id.
          seen[key] = true;
          teams.push({
            node: link,
            leagueId: match[1],
            teamId: match[2],
            name: name,
            owned: columnOwned(link) || (teamId && String(match[2]) === String(teamId)),
            top: rect.top,
            left: rect.left
          });
        }
        teams.sort(function(a, b) { return a.top - b.top || a.left - b.left; });
        if (teams.length >= 2) {
          var top = teams[0].top;
          var band = teams.filter(function(item) { return Math.abs(item.top - top) < 140; });
          band.sort(function(a, b) { return a.left - b.left; });
          if (band.length >= 2) {
            // Column 0 is visual left, column 1 is visual right — same indexes as starter cells.
            var leftHit = band[0];
            var rightHit = band[band.length - 1];
            if (String(leftHit.teamId) === String(rightHit.teamId)) {
              rightHit = band.find(function(item) { return String(item.teamId) !== String(leftHit.teamId); }) || rightHit;
            }
            var leftSide = enrichSide(leftHit);
            var rightSide = enrichSide(rightHit);
            leftSide.owned = Boolean(leftHit.owned);
            rightSide.owned = Boolean(rightHit.owned);
            var userOnRight = Boolean(rightSide.owned && !leftSide.owned);
            if (teamId && String(leftHit.teamId) === String(teamId)) userOnRight = false;
            if (teamId && String(rightHit.teamId) === String(teamId) && String(leftHit.teamId) !== String(teamId)) {
              userOnRight = true;
            }
            return { mine: leftSide, opp: rightSide, userOnRight: userOnRight };
          }
        }
        // Fallback: record-bearing nodes, but still require distinct team links when possible.
        var hits = [];
        var nodes = document.querySelectorAll('a, div, span, h2, h3, p');
        for (var n = 0; n < nodes.length; n++) {
          var value = clean(nodes[n].innerText || '');
          if (!recordOf(value) || value.length > 90 || nodes[n].querySelector('table')) continue;
          var box = nodes[n].getBoundingClientRect();
          if (!box.width || box.top > 520) continue;
          hits.push({ node: nodes[n], top: box.top, left: box.left });
        }
        hits.sort(function(a, b) { return a.top - b.top || a.left - b.left; });
        if (!hits.length) return { mine: emptySide(), opp: emptySide() };
        var bandTop = hits[0].top;
        var recordBand = hits.filter(function(item) { return Math.abs(item.top - bandTop) < 90; });
        recordBand.sort(function(a, b) { return a.left - b.left; });
        function sideFromRecordNode(node, fallbackName) {
          var link = node.querySelector ? node.querySelector('a[href*="/f1/"]') : null;
          if (!link && node.tagName && String(node.tagName).toUpperCase() === 'A') link = node;
          var idMatch = link ? (link.href || '').match(/\\/f1\\/(\\d+)\\/(\\d+)/) : null;
          return enrichSide({
            node: node,
            name: readableName(link ? (link.innerText || '') : '') || fallbackName || '',
            leagueId: idMatch ? idMatch[1] : '',
            teamId: idMatch ? idMatch[2] : ''
          });
        }
        var left = sideFromRecordNode(recordBand[0].node, '');
        var right = recordBand.length > 1 ? sideFromRecordNode(recordBand[recordBand.length - 1].node, '') : emptySide();
        if (left.name && right.name && left.name === right.name && left.teamId && right.teamId && left.teamId === right.teamId) {
          right = emptySide();
        }
        var recordUserOnRight = Boolean(teamId && right.teamId && String(right.teamId) === String(teamId) && String(left.teamId) !== String(teamId));
        return { mine: left, opp: right, userOnRight: recordUserOnRight };
      }
      function digYahooJson() {
        var sources = [];
        try { if (window.ydb) sources.push(window.ydb); } catch (err) {}
        try { if (window.App && App.main) sources.push(App.main); } catch (err) {}
        try { if (window.__NEXT_DATA__) sources.push(window.__NEXT_DATA__); } catch (err) {}
        var teams = [];
        var players = [];
        function walk(value, depth) {
          if (!value || typeof value !== 'object' || depth > 10) return;
          if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) walk(value[i], depth + 1);
            return;
          }
          noteLeagueTitle(value);
          var teamKey = value.team_key || value.teamKey || '';
          var teamName = value.name || value.team_name || value.teamName || '';
          if (teamKey && /\\.t\\.\\d+/.test(String(teamKey)) && teamName && typeof teamName === 'string') {
            var points = value.team_points || value.points || value.score;
            var total = points && (points.total != null ? points.total : points);
            var projNode = value.team_projected_points || value.projected_points;
            var proj = projNode && (projNode.total != null ? projNode.total : projNode);
            var win = value.win_probability != null ? value.win_probability : value.winOdds;
            teams.push({
              teamKey: String(teamKey),
              name: clean(teamName),
              score: total != null ? String(total) : '',
              proj: proj != null ? String(proj) : '',
              winOdds: win != null ? String(win) : '',
              logo: (value.team_logos && value.team_logos[0] && value.team_logos[0].url) || value.logo || ''
            });
          }
          if (value.player_points || value.player_projected_points || value.player_projected_stats) {
            var pname = '';
            if (value.name && value.name.full) pname = value.name.full;
            else if (typeof value.name === 'string') pname = value.name;
            else if (value.player_name) pname = value.player_name;
            if (pname) {
              function totalOf(node) {
                if (node == null) return null;
                if (typeof node === 'number' || typeof node === 'string') {
                  var direct = parseFloat(node);
                  return isFinite(direct) ? direct : null;
                }
                if (typeof node !== 'object') return null;
                if (node.total != null) {
                  var top = parseFloat(node.total);
                  if (isFinite(top)) return top;
                }
                if (Array.isArray(node)) {
                  for (var ti = 0; ti < node.length; ti++) {
                    var hit = totalOf(node[ti]);
                    if (hit != null) return hit;
                  }
                }
                var keys = Object.keys(node);
                for (var tk = 0; tk < keys.length; tk++) {
                  if (keys[tk] === 'total') continue;
                  var nested = totalOf(node[keys[tk]]);
                  if (nested != null) return nested;
                }
                return null;
              }
              var pActual = totalOf(value.player_points);
              var pProj = totalOf(value.player_projected_points)
                || totalOf(value.player_projected_stats && value.player_projected_stats.player_points)
                || totalOf(value.projected_points);
              players.push({
                name: clean(pname),
                points: pActual != null ? String(pActual) : '',
                actualPoints: pActual != null ? String(pActual) : '',
                projPoints: pProj != null ? String(pProj) : '',
                projectedPoints: pProj != null ? String(pProj) : ''
              });
            }
          }
          var keys = Object.keys(value);
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (key === 'parent' || key === 'parentNode' || key === 'ownerDocument') continue;
            try { walk(value[key], depth + 1); } catch (err2) {}
          }
        }
        var leagueTitle = '';
        function noteLeagueTitle(value) {
          if (leagueTitle || !value) return;
          var key = value.league_key || value.leagueKey || value.league_id || value.leagueId || '';
          var named = value.league_name || value.leagueName || '';
          if (!named && typeof value.name === 'string' && !value.team_key && !value.teamKey && (value.num_teams != null || value.scoring_type || value.league_type || value.current_week != null)) {
            named = value.name;
          }
          var text = readableName(named);
          if (!text || !key) return;
          if (leagueId && String(key).indexOf(String(leagueId)) === -1 && String(key) !== String(leagueId)) return;
          leagueTitle = text;
        }
        for (var s = 0; s < sources.length; s++) walk(sources[s], 0);
        return { teams: teams, players: players, leagueName: leagueTitle };
      }
      var ydbEarly = digYahooJson();
      var leagueName = realLeagueName() || ydbEarly.leagueName || '';
      var board = scoreboardSides();
      var mineSide = board.mine;
      var oppSide = board.opp;
      var userOnRight = Boolean(board.userOnRight);
      if (!leagueId && mineSide.leagueId) leagueId = mineSide.leagueId;
      // Fill gaps from embedded Yahoo JSON only when the team id matches that column.
      var ydb = ydbEarly;
      function jsonForTeamId(id) {
        if (!id || !ydb.teams) return null;
        for (var yt = 0; yt < ydb.teams.length; yt++) {
          var idTail = ((ydb.teams[yt].teamKey || '').match(/\\.t\\.(\\d+)$/) || [])[1] || '';
          if (idTail && String(idTail) === String(id)) return ydb.teams[yt];
        }
        return null;
      }
      function fillSideGaps(side, json) {
        if (!side || !json) return;
        if (!side.name && json.name) side.name = json.name;
        if (!side.score && json.score) side.score = json.score;
        if (!side.proj && json.proj) side.proj = json.proj;
        if (!side.winOdds && json.winOdds) side.winOdds = json.winOdds;
        if (!side.logo && json.logo) side.logo = json.logo;
      }
      fillSideGaps(mineSide, jsonForTeamId(mineSide.teamId));
      fillSideGaps(oppSide, jsonForTeamId(oppSide.teamId));
      if (oppSide.name && mineSide.name && oppSide.name === mineSide.name && oppSide.teamId && mineSide.teamId && oppSide.teamId === mineSide.teamId) {
        oppSide = emptySide();
      }
      var rosters = harvest();
      // Logged-in team was the right column. Move that column's name and roster to the left together.
      if (userOnRight) {
        var sideSwap = mineSide;
        mineSide = oppSide;
        oppSide = sideSwap;
        var rosterSwap = rosters.mine;
        rosters.mine = rosters.opp;
        rosters.opp = rosterSwap;
      }
      if (!teamId && mineSide.teamId) teamId = mineSide.teamId;
      // Overlay ydb player points onto roster rows matched by name when DOM missed totals.
      if (ydb.players && ydb.players.length) {
        function applyYdbPoints(list) {
          for (var i = 0; i < list.length; i++) {
            var starter = list[i];
            if (!starter || !starter.name) continue;
            if (starter.points && starter.projPoints) continue;
            var key = clean(starter.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
            for (var p = 0; p < ydb.players.length; p++) {
              var yName = clean(ydb.players[p].name).toLowerCase().replace(/[^a-z0-9]+/g, '');
              if (!yName || (yName !== key && yName.indexOf(key) === -1 && key.indexOf(yName) === -1)) continue;
              if (starter.scoreSlotSeen) {
                // Top slot already decided actual, including 0.00 and a pregame dash.
              } else if (!starter.points && ydb.players[p].actualPoints) {
                starter.points = ydb.players[p].actualPoints;
                starter.actualPoints = ydb.players[p].actualPoints;
              }
              if (!starter.projPoints && ydb.players[p].projPoints) {
                starter.projPoints = ydb.players[p].projPoints;
                starter.projectedPoints = ydb.players[p].projectedPoints || ydb.players[p].projPoints;
              }
              break;
            }
          }
        }
        applyYdbPoints(rosters.mine);
        applyYdbPoints(rosters.opp);
      }
      // If DOM missed my nickname but discovery/ydb knows it, keep the side.
      if (!mineSide.name && teamId) {
        for (var yn = 0; yn < (ydb.teams || []).length; yn++) {
          var idTail2 = ((ydb.teams[yn].teamKey || '').match(/\\.t\\.(\\d+)$/) || [])[1] || '';
          if (String(idTail2) === String(teamId) && ydb.teams[yn].name) {
            mineSide.name = ydb.teams[yn].name;
            break;
          }
        }
      }
      var lines = [];
      if (leagueName) lines.push('League: ' + leagueName);
      lines.push(mineSide.name || 'My Team');
      if (mineSide.record) lines.push(mineSide.rank ? (mineSide.record + ' | ' + mineSide.rank) : mineSide.record);
      if (mineSide.score) lines.push(mineSide.score);
      else if (mineSide.proj) lines.push(mineSide.proj);
      lines.push(oppSide.name || 'Opponent');
      if (oppSide.record) lines.push(oppSide.rank ? (oppSide.record + ' | ' + oppSide.rank) : oppSide.record);
      if (oppSide.score) lines.push(oppSide.score);
      else if (oppSide.proj) lines.push(oppSide.proj);
      lines.push('Starters');
      function pushScoreStack(player) {
        if (!player) return;
        var actual = player.actualPoints;
        var proj = player.projPoints;
        var hasProj = proj != null && proj !== '';
        if (actual === '') {
          if (hasProj) lines.push('—');
        } else if (actual != null && actual !== '') {
          lines.push(String(actual));
        } else if (player.points) {
          lines.push(String(player.points));
        }
        if (hasProj) lines.push(String(proj));
      }
      var count = Math.max(rosters.mine.length, rosters.opp.length);
      for (var i = 0; i < count; i++) {
        var minePlayer = rosters.mine[i];
        var oppPlayer = rosters.opp[i];
        if (minePlayer && !isOppMark(minePlayer.name)) {
          lines.push(minePlayer.name);
          if (minePlayer.nflTeam) lines.push(minePlayer.nflTeam + ' - ' + (minePlayer.position || minePlayer.slot));
          if (minePlayer.gameClock) lines.push(minePlayer.gameClock);
          pushScoreStack(minePlayer);
        }
        var rowSlot = (minePlayer && minePlayer.slot) || (oppPlayer && oppPlayer.slot) || '';
        if (rowSlot) lines.push(rowSlot);
        if (oppPlayer && !isOppMark(oppPlayer.name)) {
          pushScoreStack(oppPlayer);
          lines.push(oppPlayer.name);
          if (oppPlayer.nflTeam) lines.push(oppPlayer.nflTeam + ' - ' + (oppPlayer.position || oppPlayer.slot));
          if (oppPlayer.gameClock) lines.push(oppPlayer.gameClock);
        }
      }
      function winOddsNumber(value) {
        var n = parseFloat(value);
        if (!isFinite(n)) return '';
        if (n > 0 && n <= 1) n = n * 100;
        return String(Math.round(n));
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
        myProj: mineSide.proj,
        oppProj: oppSide.proj,
        myWinOdds: winOddsNumber(mineSide.winOdds),
        oppWinOdds: winOddsNumber(oppSide.winOdds),
        myLogo: mineSide.logo,
        oppLogo: oppSide.logo,
        myTeamId: mineSide.teamId || '',
        oppTeamId: oppSide.teamId || '',
        myStarters: rosters.mine,
        oppStarters: rosters.opp
      };
      return {
        href: href,
        leagueId: leagueId,
        teamId: teamId,
        teamName: mineSide.name || '',
        leagueName: leagueName,
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
      function usableLeagueName(value) {
        var text = clean(value);
        if (!text || text.length > 60) return '';
        if (/^(my teams?|leagues?(?:\\s*\\d+)?|fantasy football|yahoo|home|matchup|standings|players|mail|inbox|account|my account|sign in|sign out|settings|news|profile|notifications?)$/i.test(text)) return '';
        return text;
      }
      function leagueNameNear(node) {
        var el = node;
        for (var depth = 0; depth < 7 && el; depth++) {
          var heading = el.querySelector && el.querySelector('h1, h2, h3, h4, .Navmain-title, [class*="league-name"], [class*="LeagueName"]');
          if (heading) {
            var titled = usableLeagueName(heading.innerText || heading.textContent || '');
            if (titled) return titled;
          }
          var prev = el.previousElementSibling;
          while (prev) {
            var sibling = usableLeagueName(prev.innerText || prev.textContent || '');
            if (sibling && !/\\d+\\s*-\\s*\\d+/.test(sibling)) return sibling;
            prev = prev.previousElementSibling;
          }
          el = el.parentElement;
        }
        return '';
      }
      function leagueNumFrom(value) {
        var text = String(value || '');
        var keyed = text.match(/\\.l\\.(\\d+)/);
        if (keyed) return keyed[1];
        var path = text.match(/\\/f1\\/(\\d+)/);
        if (path) return path[1];
        if (/^\\d+$/.test(text)) return text;
        return '';
      }
      function teamNumFrom(value) {
        var text = String(value || '');
        var keyed = text.match(/\\.t\\.(\\d+)/);
        if (keyed) return keyed[1];
        var path = text.match(/\\/f1\\/\\d+\\/(\\d+)(?=\\/|$|\\?|#)/);
        if (path) return path[1];
        if (/^\\d+$/.test(text)) return text;
        return '';
      }
      function concreteMatchup(leagueId, teamId, href) {
        if (!leagueId) return '';
        var weekMatch = String(href || '').match(/[?&]week=(\\d+)/i);
        var week = weekMatch ? ('?week=' + weekMatch[1]) : '';
        if (teamId) {
          return 'https://football.fantasysports.yahoo.com/f1/' + leagueId + '/' + teamId + '/matchup' + week;
        }
        return 'https://football.fantasysports.yahoo.com/f1/' + leagueId + '/matchup' + week;
      }
      function leagueHasTeam(out, leagueId) {
        for (var i = 0; i < out.length; i++) {
          if (String(out[i].leagueId) === String(leagueId) && out[i].teamId) return true;
        }
        return false;
      }
      function dropHomeRow(out, seen, leagueId) {
        var homeKey = String(leagueId) + ':home';
        if (!seen[homeKey]) return;
        seen[homeKey] = false;
        for (var hi = out.length - 1; hi >= 0; hi--) {
          if (String(out[hi].leagueId) === String(leagueId) && !out[hi].teamId) out.splice(hi, 1);
        }
      }
      function pushTeam(out, seen, leagueId, teamId, href, teamName, leagueName) {
        leagueId = String(leagueId || '');
        teamId = String(teamId || '');
        if (!leagueId) return;
        // A team row already covers this league home — don't keep both.
        if (!teamId && leagueHasTeam(out, leagueId)) return;
        if (teamId) dropHomeRow(out, seen, leagueId);
        var key = teamId ? (leagueId + ':' + teamId) : (leagueId + ':home');
        var concrete = concreteMatchup(leagueId, teamId, href);
        var name = clean(teamName).replace(/\\d+\\s*-\\s*\\d+\\s*-\\s*\\d+.*/, '').trim();
        if (!name || name.length > 40 || /^(team\\s*\\d+|my team|opponent)$/i.test(name)) name = '';
        var leagueTitle = usableLeagueName(leagueName);
        if (seen[key]) {
          var existing = null;
          for (var ei = 0; ei < out.length; ei++) {
            if (out[ei].leagueId === leagueId && out[ei].teamId === teamId) {
              existing = out[ei];
              break;
            }
          }
          if (existing) {
            if (name && (/^Team\\s+\\d+$/i.test(existing.teamName) || !existing.teamName)) {
              existing.name = name;
              existing.teamName = name;
            }
            if (leagueTitle && !existing.leagueName) existing.leagueName = leagueTitle;
            if (concrete) {
              existing.href = concrete;
              existing.matchupUrl = concrete;
            }
          }
          return;
        }
        seen[key] = true;
        if (!name && teamId) name = 'Team ' + teamId;
        out.push({
          leagueId: leagueId,
          teamId: teamId,
          href: concrete,
          matchupUrl: concrete,
          name: name,
          teamName: name,
          leagueName: leagueTitle
        });
      }
      function dig(value, out, seen, depth) {
        if (!value || typeof value !== 'object' || depth > 8) return;
        if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) dig(value[i], out, seen, depth + 1);
          return;
        }
        var leagueCandidates = [value.league_key, value.leagueKey, value.league_id, value.leagueId];
        var leagueRaw = '';
        for (var li = 0; li < leagueCandidates.length; li++) {
          var leagueText = String(leagueCandidates[li] || '');
          if (/\\.l\\.\\d+/.test(leagueText) || /\\/f1\\/\\d+/.test(leagueText) || /^\\d+$/.test(leagueText)) {
            leagueRaw = leagueText;
            break;
          }
        }
        var leagueMetaName = value.league_name || value.leagueName || '';
        if (!leagueMetaName && typeof value.name === 'string' && !value.team_key && !value.teamKey && (value.num_teams != null || value.scoring_type || value.league_type || value.current_week != null)) {
          leagueMetaName = value.name;
        }
        if (leagueRaw && leagueMetaName) rememberLeague(leagueRaw, leagueMetaName);
        var teamCandidates = [value.team_key, value.teamKey, value.team_id, value.teamId];
        var teamRaw = '';
        for (var ti = 0; ti < teamCandidates.length; ti++) {
          var teamText = String(teamCandidates[ti] || '');
          if (/\\.t\\.\\d+/.test(teamText) || /\\/f1\\/\\d+\\/\\d+/.test(teamText) || /^\\d+$/.test(teamText)) {
            teamRaw = teamText;
            break;
          }
        }
        var rawUrl = value.url || value.href || '';
        var leagueNum = leagueNumFrom(leagueRaw) || leagueNumFrom(rawUrl);
        var teamNum = teamNumFrom(teamRaw) || teamNumFrom(rawUrl);
        if (leagueNum && (teamNum || /\\/f1\\/\\d+/.test(String(rawUrl)))) {
          pushTeam(
            out,
            seen,
            leagueNum,
            teamNum,
            rawUrl,
            teamNum ? (value.name || value.team_name || value.teamName || '') : '',
            value.league_name || value.leagueName || leagueMetaName || ''
          );
        }
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          if (key === 'parent' || key === 'parentNode' || key === 'ownerDocument') continue;
          try { dig(value[key], out, seen, depth + 1); } catch (err) {}
        }
      }
      var seen = {};
      var teams = [];
      var leagueTitles = {};
      function rememberLeague(leagueRaw, name) {
        var num = leagueNumFrom(leagueRaw);
        var title = usableLeagueName(name);
        if (!num || !title) return;
        if (!leagueTitles[num]) leagueTitles[num] = title;
      }
      // Prefer embedded JSON nicknames/league titles before sparse lobby link text.
      try { if (window.ydb) dig(window.ydb, teams, seen, 0); } catch (err) {}
      try { if (window.App && App.main) dig(App.main, teams, seen, 0); } catch (err) {}
      try {
        if (window.__NEXT_DATA__) dig(window.__NEXT_DATA__, teams, seen, 0);
      } catch (err) {}
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href || '';
        var linkName = links[i].innerText || links[i].textContent
          || links[i].getAttribute('title') || links[i].getAttribute('aria-label') || '';
        var teamMatch = href.match(/\\/f1\\/(\\d+)\\/(\\d+)(?=\\/|$|\\?|#)/);
        if (teamMatch) {
          pushTeam(teams, seen, teamMatch[1], teamMatch[2], href, linkName, leagueNameNear(links[i]));
          continue;
        }
        // League home (/f1/{id}) and league matchup (/f1/{id}/matchup) — no team id yet.
        var homeMatch = href.match(/\\/f1\\/(\\d+)(?:\\/matchup)?\\/?(?:$|[?#])/);
        if (!homeMatch) continue;
        pushTeam(teams, seen, homeMatch[1], '', href, '', leagueNameNear(links[i]));
      }
      try {
        var scripts = document.querySelectorAll('script:not([src])');
        for (var s = 0; s < scripts.length; s++) {
          var text = scripts[s].textContent || '';
          if (text.indexOf('/f1/') === -1 && text.indexOf('league_key') === -1) continue;
          var re = /\\/f1\\/(\\d+)\\/(\\d+)(?=\\/|$|\\?|#|["'])/g;
          var found;
          while ((found = re.exec(text))) {
            pushTeam(teams, seen, found[1], found[2], '', '', '');
          }
          var homeRe = /\\/f1\\/(\\d+)(?:\\/matchup)?(?=["'?\\s]|$)/g;
          var homeFound;
          while ((homeFound = homeRe.exec(text))) {
            pushTeam(teams, seen, homeFound[1], '', '', '', '');
          }
          var keyRe = /"league_key"\\s*:\\s*"(\\d+\\.l\\.\\d+)"/g;
          var keyHit;
          while ((keyHit = keyRe.exec(text))) {
            var slice = text.slice(Math.max(0, keyHit.index - 400), keyHit.index + 700);
            var nameHit = slice.match(/"name"\\s*:\\s*"([^"\\\\]{2,60})"/);
            if (nameHit) rememberLeague(keyHit[1], nameHit[1]);
          }
        }
      } catch (err) {}
      var homeLinks = document.querySelectorAll('a[href*="/f1/"]');
      for (var h = 0; h < homeLinks.length; h++) {
        var homeHref = homeLinks[h].href || '';
        var home = homeHref.match(/\\/f1\\/(\\d+)\\/?(?:$|[?#])/);
        if (!home) continue;
        var homeName = usableLeagueName(homeLinks[h].innerText || homeLinks[h].textContent || homeLinks[h].getAttribute('title') || '');
        if (homeName) rememberLeague(home[1], homeName);
        pushTeam(teams, seen, home[1], '', homeHref, '', homeName);
      }
      for (var t = 0; t < teams.length; t++) {
        if (!teams[t].leagueName && leagueTitles[teams[t].leagueId]) {
          teams[t].leagueName = leagueTitles[teams[t].leagueId];
        }
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

    /// Pure digits, or the id inside a Yahoo key (`461.l.12345` / `461.l.12345.t.2`).
    static func numericId(_ value: String, team: Bool = false) -> String {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty && text.allSatisfy(\.isNumber) { return text }
        let pattern = team ? "\\.t\\.(\\d+)" : "\\.l\\.(\\d+)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return "" }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges > 1,
              let piece = Range(match.range(at: 1), in: text) else {
            return ""
        }
        return String(text[piece])
    }

    static func pathMatchesConcrete(_ url: URL, leagueId: String, teamId: String) -> Bool {
        let host = url.host?.lowercased() ?? ""
        guard host == "football.fantasysports.yahoo.com" || host.hasSuffix(".football.fantasysports.yahoo.com") else {
            return false
        }
        let expected = teamId.isEmpty
            ? "/f1/\(leagueId)/matchup"
            : "/f1/\(leagueId)/\(teamId)/matchup"
        var path = url.path.lowercased()
        if path.hasSuffix("/") { path.removeLast() }
        return path == expected
    }

    static func isConcreteMatchupURL(_ value: String) -> Bool {
        guard let url = URL(string: value) else { return false }
        let league = leagueId(from: url)
        guard !league.isEmpty else { return false }
        return pathMatchesConcrete(url, leagueId: league, teamId: teamId(from: url))
    }

    static func matchupURL(leagueId: String, teamId: String = "", week: String, fallback: URL?) -> URL? {
        let league = numericId(leagueId).isEmpty ? Self.leagueId(from: fallback) : numericId(leagueId)
        let explicitTeam = numericId(teamId, team: true)
        let team = explicitTeam.isEmpty ? Self.teamId(from: fallback) : explicitTeam
        // Bare lobby (football.fantasysports.yahoo.com or /f1 with no league id) is not a matchup.
        guard !league.isEmpty else { return nil }
        let weekValue = week.isEmpty ? Self.week(from: fallback) : week
        if let fallback, pathMatchesConcrete(fallback, leagueId: league, teamId: team) {
            if weekValue.isEmpty || Self.week(from: fallback) == weekValue {
                return fallback
            }
            return applying(week: weekValue, to: fallback)
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "football.fantasysports.yahoo.com"
        components.path = team.isEmpty
            ? "/f1/\(league)/matchup"
            : "/f1/\(league)/\(team)/matchup"
        if !weekValue.isEmpty {
            components.queryItems = [URLQueryItem(name: "week", value: weekValue)]
        }
        return components.url
    }

    static func isMatchup(_ url: URL?) -> Bool {
        url?.path.lowercased().contains("/matchup") == true
    }

    static func payload(_ value: Any?, url: URL?) -> [String: Any] {
        let body = dictionary(value)
        let hrefText = string(body["href"])
        let href = url ?? URL(string: hrefText)
        let league = first(string(body["leagueId"]), leagueId(from: href))
        let team = first(string(body["teamId"]), teamId(from: href))
        let weekValue = first(week(from: href), week(from: URL(string: hrefText)))
        let built = matchupURL(leagueId: league, teamId: team, week: weekValue, fallback: href)?.absoluteString ?? ""
        let matchup = isConcreteMatchupURL(built) ? built : ""
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
    var startURL: URL?
    var preferredWeek = ""

    private var webView: WKWebView!
    private var useButton: UIBarButtonItem!
    private var pollTimer: Timer?
    private var finished = false
    private var capturing = false
    private var captureQueued = false
    private var pushedMatchup = false
    private var awaitingMatchup = false
    private var listScanInFlight = false
    private var listScanAt: Date?
    private var pendingLeagueId = ""
    private var pendingTeamId = ""
    private var matchupPushAttempts = 0
    private var lastCookieKickAt: Date?
    private var listScanMisses = 0

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
        instructions.text = "1. Sign in to Yahoo  2. RootMap finds all your leagues and loads this week’s matchups automatically."
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
        let initial = startURL ?? YahooLinks.home
        if let startURL, YahooLinks.isMatchup(startURL) {
            pendingLeagueId = YahooLinks.leagueId(from: startURL)
            pendingTeamId = YahooLinks.teamId(from: startURL)
            pushedMatchup = true
            awaitingMatchup = true
            matchupPushAttempts = 1
            navigationItem.title = "Opening Yahoo Matchup"
        }
        webView.load(URLRequest(url: initial))
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
                matchupPushAttempts = 0
                refreshReadyState()
                return
            }
            // Yahoo often lands on league home instead of /matchup — force the matchup tab.
            if YahooLinks.isMatchup(webView.url) {
                scheduleCapture()
            } else {
                pushedMatchup = false
                continueMatchup()
            }
            return
        }
        refreshReadyState()
        if YahooLinks.isLogin(webView.url) { return }
        if YahooLinks.isLeagueList(webView.url) {
            maybeScanList()
            return
        }
        if pendingLeagueId.isEmpty {
            pendingLeagueId = YahooLinks.leagueId(from: webView.url)
        }
        if pendingTeamId.isEmpty {
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
                if onLogin {
                    self.navigationItem.title = "Sign in to Yahoo"
                } else if YahooLinks.isMatchup(self.webView.url) {
                    self.navigationItem.title = "Reading Yahoo Matchup"
                } else if leagueId.isEmpty {
                    self.navigationItem.title = loggedIn ? "Finding your leagues" : "Sign in to Yahoo"
                } else {
                    self.navigationItem.title = "Yahoo connected"
                }
                // As soon as Yahoo login cookies appear, discover leagues / open matchup.
                if loggedIn {
                    self.kickMatchupAfterCookies()
                }
            }
        }
    }

    private func kickMatchupAfterCookies() {
        guard !finished, !capturing, !captureQueued, !awaitingMatchup else { return }
        if YahooLinks.isLogin(webView.url) { return }
        if let lastCookieKickAt, Date().timeIntervalSince(lastCookieKickAt) < 1.0 { return }
        lastCookieKickAt = Date()
        continueMatchup()
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
            maybeScanList(force: true)
            return
        }
        continueMatchup()
    }

    private func maybeScanList(force: Bool = false) {
        guard !finished, !listScanInFlight, YahooLinks.isLeagueList(webView.url) else { return }
        if !force, let listScanAt, Date().timeIntervalSince(listScanAt) < 1.0 { return }
        listScanInFlight = true
        navigationItem.title = "Finding your leagues"
        webView.evaluateJavaScript(YahooLinks.listTeamsScript) { [weak self] value, _ in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                self.listScanInFlight = false
                self.listScanAt = Date()
                guard YahooLinks.isLeagueList(self.webView.url) else { return }
                let teams = self.teams(from: value)
                if !teams.isEmpty {
                    self.listScanMisses = 0
                    // Hand every discovered league back to JS for silent /matchup fetches.
                    self.finishWithDiscoveredLeagues(teams)
                    return
                }
                self.listScanMisses += 1
                if self.listScanMisses >= 6 {
                    self.finishWithDiscoveredLeagues([])
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
            let leagueId = YahooLinks.numericId(item["leagueId"] as? String ?? "")
            let teamId = YahooLinks.numericId(item["teamId"] as? String ?? "", team: true)
            // League home rows have a league id and no team id. Bare lobby rows have neither.
            if leagueId.isEmpty { return nil }
            let href = (item["matchupUrl"] as? String) ?? (item["href"] as? String) ?? ""
            let matchup = YahooLinks.matchupURL(
                leagueId: leagueId,
                teamId: teamId,
                week: YahooLinks.week(from: URL(string: href)),
                fallback: URL(string: href)
            )?.absoluteString ?? ""
            guard YahooLinks.isConcreteMatchupURL(matchup) else { return nil }
            let teamName = item["teamName"] as? String ?? item["name"] as? String ?? ""
            let leagueName = item["leagueName"] as? String ?? ""
            return [
                "leagueId": leagueId,
                "teamId": teamId,
                "name": teamName,
                "teamName": teamName,
                "leagueName": leagueName,
                "href": matchup,
                "matchupUrl": matchup
            ]
        }
    }

    private func finishWithDiscoveredLeagues(_ teams: [[String: String]]) {
        guard !finished else { return }
        capturing = true
        finished = true
        pollTimer?.invalidate()
        let week = preferredWeek
        let leagues: [[String: Any]] = teams.compactMap { team in
            let leagueId = team["leagueId"] ?? ""
            let teamId = team["teamId"] ?? ""
            let stored = team["matchupUrl"] ?? team["href"] ?? ""
            let matchup = YahooLinks.matchupURL(
                leagueId: leagueId,
                teamId: teamId,
                week: week,
                fallback: URL(string: stored)
            )?.absoluteString ?? ""
            guard YahooLinks.isConcreteMatchupURL(matchup) else { return nil }
            return [
                "leagueId": leagueId,
                "teamId": teamId,
                "teamName": team["teamName"] ?? team["name"] ?? "",
                "leagueName": team["leagueName"] ?? "",
                "matchupUrl": matchup
            ]
        }
        var payload: [String: Any] = [
            "leagues": leagues,
            "discovered": true,
            "pageText": "",
            "html": "",
            "lineup": ""
        ]
        if let first = leagues.first {
            payload["leagueId"] = first["leagueId"] ?? ""
            payload["teamId"] = first["teamId"] ?? ""
            payload["matchupUrl"] = first["matchupUrl"] ?? ""
        } else {
            payload["leagueId"] = ""
            payload["teamId"] = ""
            payload["matchupUrl"] = ""
        }
        let finish = onFinish
        dismiss(animated: true) {
            finish?(payload)
        }
    }

    private func openTeam(_ leagueId: String, _ teamId: String) {
        guard !finished, !leagueId.isEmpty else { return }
        pendingLeagueId = leagueId
        pendingTeamId = teamId
        matchupPushAttempts += 1
        pushedMatchup = true
        awaitingMatchup = true
        captureQueued = false
        navigationItem.title = "Opening Yahoo Matchup"
        let week = firstNonEmpty(YahooLinks.week(from: webView.url), preferredWeek)
        let fallbackPath = teamId.isEmpty
            ? "https://football.fantasysports.yahoo.com/f1/\(leagueId)"
            : "https://football.fantasysports.yahoo.com/f1/\(leagueId)/\(teamId)"
        let fallback = URL(string: fallbackPath)
        if let matchup = YahooLinks.matchupURL(leagueId: leagueId, teamId: teamId, week: week, fallback: fallback) {
            webView.load(URLRequest(url: matchup))
        }
    }

    private func firstNonEmpty(_ primary: String, _ fallback: String) -> String {
        primary.isEmpty ? fallback : primary
    }

    private func continueMatchup() {
        guard !finished, !capturing, !captureQueued else { return }
        if YahooLinks.isLogin(webView.url) {
            navigationItem.title = "Finish Yahoo sign-in"
            return
        }
        // Lobby / My Teams page: discover every league, then let JS silent-fetch matchups.
        if YahooLinks.isLeagueList(webView.url) {
            maybeScanList()
            return
        }
        let pageLeagueId = YahooLinks.leagueId(from: webView.url)
        if pendingLeagueId.isEmpty { pendingLeagueId = pageLeagueId }
        if pendingTeamId.isEmpty { pendingTeamId = YahooLinks.teamId(from: webView.url) }
        let leagueId = firstNonEmpty(pendingLeagueId, pageLeagueId)
        if leagueId.isEmpty {
            maybeScanList()
            return
        }
        if YahooLinks.isMatchup(webView.url) {
            scheduleCapture()
            return
        }
        // Always prefer /matchup over league home / team pages — Yahoo often redirects there.
        if matchupPushAttempts < 4 {
            openTeam(leagueId, pendingTeamId)
            return
        }
        scheduleCapture()
    }

    private func scheduleCapture() {
        guard !finished, !capturing, !captureQueued else { return }
        // Prefer waiting until we are actually on the Matchup tab.
        if !YahooLinks.isMatchup(webView.url), matchupPushAttempts < 4 {
            continueMatchup()
            return
        }
        captureQueued = true
        navigationItem.title = "Reading Yahoo Matchup"
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
        let leagueId = (payload["leagueId"] as? String) ?? ""
        let teamId = (payload["teamId"] as? String) ?? ""
        let matchupUrl = (payload["matchupUrl"] as? String) ?? ""
        if !leagueId.isEmpty {
            payload["leagues"] = [[
                "leagueId": leagueId,
                "teamId": teamId,
                "teamName": "",
                "leagueName": "",
                "matchupUrl": matchupUrl
            ]]
            payload["discovered"] = true
        } else {
            payload["leagues"] = []
            payload["discovered"] = false
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
    private var redirectedToMatchup = false
    private var targetURL: URL?
    private var completion: ((Result<[String: Any], Error>) -> Void)?

    func start(in host: UIView, url: URL, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        self.completion = completion
        self.targetURL = url
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
        // If Yahoo bounced to league home, force one navigation to the Matchup tab.
        if !YahooLinks.isMatchup(webView.url), !redirectedToMatchup {
            redirectedToMatchup = true
            let league = firstNonEmpty(
                YahooLinks.leagueId(from: targetURL),
                YahooLinks.leagueId(from: webView.url)
            )
            let team = firstNonEmpty(
                YahooLinks.teamId(from: targetURL),
                YahooLinks.teamId(from: webView.url)
            )
            let week = firstNonEmpty(
                YahooLinks.week(from: targetURL),
                YahooLinks.week(from: webView.url)
            )
            if let matchup = YahooLinks.matchupURL(
                leagueId: league,
                teamId: team,
                week: week,
                fallback: targetURL
            ), matchup.absoluteString != webView.url?.absoluteString {
                webView.load(URLRequest(url: matchup))
                return
            }
        }
        YahooLinks.captureWhenReady(webView: webView, attempt: 0, stillActive: { [weak self] in
            self?.done == false
        }) { [weak self] value in
            guard let self, !self.done else { return }
            self.succeed(YahooLinks.payload(value, url: webView.url))
        }
    }

    private func firstNonEmpty(_ primary: String, _ fallback: String) -> String {
        primary.isEmpty ? fallback : primary
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
