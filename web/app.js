import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

(function () {
  "use strict";

  var app = initializeApp(firebaseConfig);
  var auth = getAuth(app);
  var db = getFirestore(app);
  var googleProvider = new GoogleAuthProvider();

  var COVER_COLORS = ["#2f6f5e", "#3a5a8c", "#8c4f3a", "#6b4f8c", "#a3762f", "#3a7a8c", "#7a3a5a"];

  // ---------- small helpers ----------
  function dayKey(d) {
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function startOfDay(d) { var r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function clockFmt(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var s = totalSeconds % 60, m = Math.floor(totalSeconds / 60) % 60, h = Math.floor(totalSeconds / 3600);
    var pad2 = function (n) { return String(n).padStart(2, "0"); };
    return h > 0 ? (h + ":" + pad2(m) + ":" + pad2(s)) : (m + ":" + pad2(s));
  }
  function coverColor(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return COVER_COLORS[hash % COVER_COLORS.length];
  }
  function coverHtml(b, extraClass) {
    var cls = "cover" + (extraClass ? " " + extraClass : "");
    var inner = escapeHtml(initials(b.title));
    if (b.coverUrl) {
      inner += '<img src="' + escapeHtml(b.coverUrl) + '" alt="" loading="lazy" onerror="this.remove()" />';
    }
    return '<div class="' + cls + '" style="background:' + coverColor(b.id) + '">' + inner + '</div>';
  }
  // Effective shelf for a book. Older books have no `status` field, so we
  // derive it from finishedAt for backward compatibility.
  function bookStatus(b) {
    if (b.status) return b.status;
    return b.finishedAt ? "finished" : "reading";
  }
  function starString(n) {
    n = Math.max(0, Math.min(5, Math.round(n || 0)));
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }
  function humanDuration(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    var h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h >= 100) return Math.round(h) + "h";
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m";
    return "under a minute";
  }
  function initials(title) {
    if (!title) return "?";
    var words = title.trim().split(/\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w[0]); });
    if (!words.length) return title[0].toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function reportError(err) {
    console.error(err);
    alert("Something went wrong: " + (err && err.message ? err.message : err));
  }

  // ---------- Firestore-backed state ----------
  var currentUser = null;
  var state = { books: [], sessions: [], goal: { minutesPerDay: 0 } };
  var unsubscribers = [];

  function booksCol() { return collection(db, "users", currentUser.uid, "books"); }
  function sessionsCol() { return collection(db, "users", currentUser.uid, "sessions"); }
  function goalDocRef() { return doc(db, "users", currentUser.uid, "goal", "current"); }

  function attachListeners() {
    unsubscribers.push(onSnapshot(booksCol(), function (snap) {
      state.books = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderAll();
    }, reportError));
    unsubscribers.push(onSnapshot(sessionsCol(), function (snap) {
      state.sessions = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderAll();
    }, reportError));
    unsubscribers.push(onSnapshot(goalDocRef(), function (snap) {
      state.goal = snap.exists() ? snap.data() : { minutesPerDay: 0 };
      renderAll();
    }, reportError));
  }
  function detachListeners() {
    unsubscribers.forEach(function (u) { u(); });
    unsubscribers = [];
    state = { books: [], sessions: [], goal: { minutesPerDay: 0 } };
  }

  var nav = { tab: "library", filter: "reading", bookId: null };
  var timerState = null; // { bookId, accumulated, running, resumeAt, intervalId }

  // ---------- derived helpers ----------
  function book(id) { return state.books.find(function (b) { return b.id === id; }); }
  function sessionsFor(bookId) { return state.sessions.filter(function (s) { return s.bookId === bookId; }); }
  function totalSecondsFor(bookId) { return sessionsFor(bookId).reduce(function (a, s) { return a + s.durationSeconds; }, 0); }
  function progressFraction(b) { return b.pageCount > 0 ? Math.min(1, Math.max(0, b.currentPage / b.pageCount)) : 0; }

  function secondsByDay() {
    var totals = {};
    state.sessions.forEach(function (s) { totals[s.dayKey] = (totals[s.dayKey] || 0) + s.durationSeconds; });
    return totals;
  }
  function rangeBounds(range) {
    var today = startOfDay(new Date());
    if (range === "Day") return [today, addDays(today, 1)];
    if (range === "Week") return [addDays(today, -6), addDays(today, 1)];
    if (range === "Month") return [addDays(today, -29), addDays(today, 1)];
    return [addDays(today, -364), addDays(today, 1)];
  }
  function dailyTotals(start, end) {
    var totals = secondsByDay();
    var buckets = [];
    var cursor = startOfDay(start);
    var endDay = startOfDay(end);
    while (cursor < endDay) {
      var key = dayKey(cursor);
      buckets.push({ date: new Date(cursor), seconds: totals[key] || 0 });
      cursor = addDays(cursor, 1);
    }
    return buckets;
  }
  function currentStreak(minMinutes) {
    var totals = secondsByDay();
    var minSeconds = minMinutes * 60;
    var cursor = startOfDay(new Date());
    var streak = 0;
    while (true) {
      var seconds = totals[dayKey(cursor)] || 0;
      if (seconds >= minSeconds) { streak++; cursor = addDays(cursor, -1); }
      else break;
      if (streak > 3650) break;
    }
    return streak;
  }
  function todaySeconds() { return secondsByDay()[dayKey(new Date())] || 0; }

  // ---------- rendering shell ----------
  var titlebarEl = document.getElementById("titlebar");
  var screenEl = document.getElementById("screen");
  var tabbarEl = document.getElementById("tabbar");
  var sheetBackdrop = document.getElementById("sheetBackdrop");
  var sheetEl = document.getElementById("sheet");

  var TABS = [
    { id: "library", label: "Library", icon: "📚" },
    { id: "stats", label: "Stats", icon: "📊" },
    { id: "goal", label: "Goal", icon: "🎯" }
  ];

  function renderTabbar() {
    tabbarEl.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.id + '" class="' + (nav.tab === t.id && !nav.bookId ? "active" : "") + '">' +
        '<span class="icon">' + t.icon + '</span><span>' + t.label + '</span></button>';
    }).join("");
    tabbarEl.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        nav.bookId = null;
        nav.tab = btn.getAttribute("data-tab");
        renderAll();
      });
    });
  }

  function renderAll() {
    if (!currentUser) return;
    if (nav.bookId) renderBookDetail(nav.bookId);
    else if (nav.tab === "library") renderLibrary();
    else if (nav.tab === "stats") renderStats();
    else renderGoal();
    renderTabbar();
  }

  // ---------- Library ----------
  var SHELVES = [
    { id: "want", label: "Want to Read" },
    { id: "reading", label: "Reading" },
    { id: "finished", label: "Finished" }
  ];
  function shelfCount(id) { return state.books.filter(function (b) { return bookStatus(b) === id; }).length; }

  function renderLibrary() {
    if (nav.search == null) nav.search = "";
    if (!nav.sort) nav.sort = "added";
    titlebarEl.innerHTML =
      '<h2>Library</h2>' +
      '<button class="action" id="addBtn" aria-label="Add book">＋</button>';
    document.getElementById("addBtn").addEventListener("click", openAddBookSheet);

    var html = '<div class="segmented">' +
      SHELVES.map(function (s) {
        var count = shelfCount(s.id);
        return '<button data-filter="' + s.id + '" class="' + (nav.filter === s.id ? "active" : "") + '">' +
          s.label + (count ? ' <span class="seg-count">' + count + '</span>' : '') + '</button>';
      }).join("") + '</div>' +
      '<div class="lib-controls">' +
        '<input id="libSearch" class="lib-search" type="search" placeholder="Search your shelf…" value="' + escapeHtml(nav.search) + '" />' +
        '<select id="libSort" class="lib-sort">' +
          [["added", "Recently added"], ["title", "Title A–Z"], ["progress", "Progress"], ["rating", "Rating"]]
            .map(function (o) { return '<option value="' + o[0] + '"' + (nav.sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") +
        '</select>' +
      '</div>' +
      '<div id="bookList"></div>';
    screenEl.innerHTML = html;

    function currentList() {
      var q = nav.search.trim().toLowerCase();
      var list = state.books.filter(function (b) { return bookStatus(b) === nav.filter; }).filter(function (b) {
        if (!q) return true;
        return (b.title || "").toLowerCase().indexOf(q) >= 0 || (b.authors || "").toLowerCase().indexOf(q) >= 0;
      });
      list.sort(function (a, b) {
        if (nav.sort === "title") return (a.title || "").localeCompare(b.title || "");
        if (nav.sort === "rating") return (b.rating || 0) - (a.rating || 0) || (new Date(b.addedAt) - new Date(a.addedAt));
        if (nav.sort === "progress") return progressFraction(b) - progressFraction(a);
        return new Date(b.addedAt) - new Date(a.addedAt);
      });
      return list;
    }

    function paintList() {
      var listEl = document.getElementById("bookList");
      var list = currentList();
      if (list.length === 0) {
        var emptyMsg = nav.search.trim()
          ? '<strong>No matches</strong><span>Nothing on this shelf matches "' + escapeHtml(nav.search.trim()) + '".</span>'
          : nav.filter === "want"
            ? '<strong>No wishlist yet</strong><span>Tap ＋ and add books to your "want to read" shelf.</span>'
            : nav.filter === "reading"
              ? '<strong>Your shelf is empty</strong><span>Tap ＋ to add the books you\'re reading.</span>'
              : '<strong>Nothing finished yet</strong><span>Books you mark finished will show up here.</span>';
        listEl.innerHTML = '<div class="empty"><div class="glyph">📖</div>' + emptyMsg + '</div>';
        return;
      }
      listEl.innerHTML = '<div class="book-grid">' + list.map(function (b) {
        var frac = progressFraction(b);
        return '<div class="row" data-open="' + b.id + '">' +
          '<button class="row-del" data-del="' + b.id + '" aria-label="Delete">✕</button>' +
          coverHtml(b) +
          '<div class="row-body">' +
            '<p class="row-title">' + escapeHtml(b.title) + '</p>' +
            '<p class="row-author">' + escapeHtml(b.authors || "Unknown author") + '</p>' +
            (b.rating ? '<p class="row-stars">' + starString(b.rating) + '</p>' : '') +
            (b.pageCount > 0 && nav.filter !== "want"
              ? '<div class="progress-line"><div class="progress-track"><span style="width:' + (frac * 100) + '%"></span></div>' +
                '<span class="pages">' + b.currentPage + '/' + b.pageCount + '</span></div>'
              : '') +
          '</div>' +
        '</div>';
      }).join("") + '</div>';

      listEl.querySelectorAll("[data-open]").forEach(function (row) {
        row.addEventListener("click", function (e) {
          if (e.target.closest("[data-del]")) return;
          nav.bookId = row.getAttribute("data-open");
          renderAll();
        });
      });
      listEl.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var id = btn.getAttribute("data-del");
          if (confirm("Remove this book and its reading history? This can't be undone.")) {
            deleteBook(id);
          }
        });
      });
    }

    paintList();

    screenEl.querySelectorAll("[data-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () { nav.filter = btn.getAttribute("data-filter"); renderLibrary(); });
    });
    document.getElementById("libSearch").addEventListener("input", function (e) { nav.search = e.target.value; paintList(); });
    document.getElementById("libSort").addEventListener("change", function (e) { nav.sort = e.target.value; paintList(); });
  }

  async function deleteBook(id) {
    try {
      var batch = writeBatch(db);
      batch.delete(doc(booksCol(), id));
      var snap = await getDocs(query(sessionsCol(), where("bookId", "==", id)));
      snap.forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
    } catch (err) { reportError(err); }
  }

  // Detects a 10- or 13-digit ISBN (allowing spaces/hyphens, trailing X on ISBN-10).
  function normalizeIsbn(q) {
    var compact = q.replace(/[\s-]/g, "");
    if (/^\d{13}$/.test(compact)) return compact;
    if (/^\d{9}[\dXx]$/.test(compact)) return compact.toUpperCase();
    return null;
  }

  // Looks books up via the Open Library search API (public, no key, CORS-enabled).
  async function searchOpenLibrary(q) {
    var isbn = normalizeIsbn(q);
    var fields = "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn";
    var url = "https://openlibrary.org/search.json?limit=12&fields=" + fields + "&" +
      (isbn ? "isbn=" + encodeURIComponent(isbn) : "q=" + encodeURIComponent(q));
    var res = await fetch(url);
    if (!res.ok) throw new Error("Search failed (" + res.status + ")");
    var data = await res.json();
    return (data.docs || []).map(function (d) {
      var coverUrl = "";
      if (d.cover_i) coverUrl = "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg";
      else if (d.isbn && d.isbn.length) coverUrl = "https://covers.openlibrary.org/b/isbn/" + d.isbn[0] + "-M.jpg";
      return {
        title: d.title || "",
        authors: (d.author_name || []).join(", "),
        pageCount: d.number_of_pages_median > 0 ? d.number_of_pages_median : 0,
        year: d.first_publish_year || null,
        coverUrl: coverUrl
      };
    }).filter(function (r) { return r.title; });
  }

  function openAddBookSheet() {
    var selectedCover = "";
    sheetEl.innerHTML =
      '<div class="titlebar"><button class="action text" id="cancelAdd">Cancel</button><h2>Add Book</h2><button class="action text" id="saveAdd" style="font-weight:700;">Save</button></div>' +
      '<div class="screen">' +
        '<div class="field"><label for="f-search">Search by title or ISBN</label>' +
          '<div class="search-row"><input id="f-search" placeholder="e.g. Klara and the Sun or 9780571364886" />' +
          '<button type="button" class="btn small primary" id="f-searchBtn">Search</button></div></div>' +
        '<div id="f-results" class="search-results"></div>' +
        '<div class="or-divider">or enter manually</div>' +
        '<div class="field"><label for="f-title">Title</label><input id="f-title" placeholder="e.g. Klara and the Sun" /></div>' +
        '<div class="field"><label for="f-authors">Authors</label><input id="f-authors" placeholder="Comma-separated" /></div>' +
        '<div class="field"><label for="f-pages">Page count (optional)</label><input id="f-pages" inputmode="numeric" placeholder="e.g. 320" /></div>' +
        '<div class="field"><label>Add to shelf</label>' +
          '<div class="segmented" id="f-shelf">' +
            SHELVES.map(function (s) {
              return '<button type="button" data-shelf="' + s.id + '" class="' + (s.id === "reading" ? "active" : "") + '">' + s.label + '</button>';
            }).join("") +
          '</div></div>' +
      '</div>';

    var chosenShelf = "reading";
    document.getElementById("cancelAdd").addEventListener("click", closeSheet);
    var searchInput = document.getElementById("f-search");
    var searchBtn = document.getElementById("f-searchBtn");
    var resultsEl = document.getElementById("f-results");
    var titleInput = document.getElementById("f-title");
    var authorsInput = document.getElementById("f-authors");
    var pagesInput = document.getElementById("f-pages");
    var saveBtn = document.getElementById("saveAdd");

    function refreshDisabled() { saveBtn.style.opacity = titleInput.value.trim() ? "1" : "0.4"; }
    titleInput.addEventListener("input", function () { selectedCover = ""; refreshDisabled(); });
    refreshDisabled();

    async function runSearch() {
      var q = searchInput.value.trim();
      if (!q) return;
      resultsEl.innerHTML = '<p class="search-note">Searching…</p>';
      try {
        var results = await searchOpenLibrary(q);
        if (!results.length) { resultsEl.innerHTML = '<p class="search-note">No matches. Try another title, or enter the book manually below.</p>'; return; }
        resultsEl.innerHTML = results.map(function (r, i) {
          var thumb = r.coverUrl
            ? '<img class="sr-cover" src="' + escapeHtml(r.coverUrl) + '" alt="" loading="lazy" onerror="this.remove()" />'
            : '<span class="sr-cover ph">' + escapeHtml(initials(r.title)) + '</span>';
          var sub = [r.authors || "Unknown author", r.year ? String(r.year) : "", r.pageCount ? r.pageCount + " pp" : ""]
            .filter(Boolean).join(" · ");
          return '<button type="button" class="search-result" data-i="' + i + '">' + thumb +
            '<span class="sr-body"><span class="sr-title">' + escapeHtml(r.title) + '</span>' +
            '<span class="sr-sub">' + escapeHtml(sub) + '</span></span></button>';
        }).join("");
        resultsEl.querySelectorAll(".search-result").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var r = results[parseInt(btn.getAttribute("data-i"), 10)];
            titleInput.value = r.title;
            authorsInput.value = r.authors;
            pagesInput.value = r.pageCount ? String(r.pageCount) : "";
            selectedCover = r.coverUrl || "";
            resultsEl.innerHTML = '<p class="search-note">Selected — review below and tap Save.</p>';
            refreshDisabled();
          });
        });
      } catch (err) {
        resultsEl.innerHTML = '<p class="search-note">Couldn\'t search right now. You can still add the book manually below.</p>';
        console.error(err);
      }
    }

    searchBtn.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });

    document.getElementById("f-shelf").querySelectorAll("[data-shelf]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        chosenShelf = btn.getAttribute("data-shelf");
        document.getElementById("f-shelf").querySelectorAll("[data-shelf]").forEach(function (b2) {
          b2.classList.toggle("active", b2 === btn);
        });
      });
    });

    saveBtn.addEventListener("click", function () {
      var title = titleInput.value.trim();
      if (!title) return;
      var authors = authorsInput.value.trim();
      var pages = parseInt(pagesInput.value, 10);
      var now = new Date().toISOString();
      addDoc(booksCol(), {
        title: title, authors: authors, pageCount: isNaN(pages) ? 0 : pages,
        coverUrl: selectedCover || "",
        currentPage: 0, addedAt: now, status: chosenShelf,
        finishedAt: chosenShelf === "finished" ? now : null,
        rating: 0, review: ""
      }).catch(reportError);
      closeSheet();
    });
    openSheet();
  }

  // ---------- Book detail ----------
  function renderBookDetail(id) {
    var b = book(id);
    if (!b) { nav.bookId = null; renderLibrary(); renderTabbar(); return; }

    titlebarEl.innerHTML =
      '<button class="action text" id="backBtn">‹ Library</button><h2 style="font-size:15px;"></h2>' +
      '<button class="action" id="menuBtn" aria-label="More">⋯</button>';
    document.getElementById("backBtn").addEventListener("click", function () { nav.bookId = null; renderAll(); });
    document.getElementById("menuBtn").addEventListener("click", function () { openBookMenu(b); });

    var total = totalSecondsFor(b.id);
    var frac = progressFraction(b);
    var status = bookStatus(b);
    var sessions = sessionsFor(b.id).slice().sort(function (a, c) { return new Date(c.startedAt) - new Date(a.startedAt); }).slice(0, 20);

    // Estimated time to finish, from the reader's own pace so far.
    var paceNote = "";
    if (status !== "finished" && b.pageCount > 0 && b.currentPage > 0 && b.currentPage < b.pageCount && total > 0) {
      var secondsPerPage = total / b.currentPage;
      var secLeft = secondsPerPage * (b.pageCount - b.currentPage);
      paceNote = '<p class="pace-note">⏳ About ' + humanDuration(secLeft) + ' left at your pace</p>';
    }

    var statusBadge = status === "finished"
      ? '<p class="status-badge finished">✓ Finished' + (b.finishedAt ? ' · ' + new Date(b.finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : '') + '</p>'
      : status === "want"
        ? '<p class="status-badge want">🔖 Want to read</p>'
        : '<p class="status-badge reading">📖 Currently reading</p>';

    screenEl.innerHTML =
      '<div class="detail-grid">' +
        '<div>' +
          '<div class="book-header">' +
            coverHtml(b, "lg") +
            '<div class="meta"><h3>' + escapeHtml(b.title) + '</h3><p>' + escapeHtml(b.authors || "Unknown author") + '</p>' +
            statusBadge +
            '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="stat-pair">' +
              '<div><p class="label">Progress</p><p class="value">' + b.currentPage + ' / ' + (b.pageCount > 0 ? b.pageCount : "—") + '</p></div>' +
              '<div class="right"><p class="label">Total time</p><p class="value">' + clockFmt(total) + '</p></div>' +
            '</div>' +
            '<div class="progress-track" style="height:6px;"><span style="width:' + (frac * 100) + '%"></span></div>' +
            paceNote +
            '<button class="btn primary" id="startReading">▶ Start reading</button>' +
            '<button class="btn secondary" id="logPast">🗓 Log past session</button>' +
          '</div>' +
          '<div class="card">' +
            '<p class="section-title" style="margin-top:0;">Your rating &amp; notes</p>' +
            '<div class="stars" id="starRow">' +
              [1, 2, 3, 4, 5].map(function (n) {
                return '<button type="button" class="star' + ((b.rating || 0) >= n ? " on" : "") + '" data-star="' + n + '" aria-label="' + n + ' stars">★</button>';
              }).join("") +
              (b.rating ? '<button type="button" class="star-clear" id="starClear">clear</button>' : '') +
            '</div>' +
            '<textarea id="reviewBox" class="review-box" rows="4" placeholder="Jot down thoughts, quotes, or a review…">' + escapeHtml(b.review || "") + '</textarea>' +
            '<button class="btn small primary" id="saveReview" disabled>Save notes</button>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<p class="section-title" style="margin-top:0;">History</p>' +
          (sessions.length === 0
            ? '<p class="footer-note">No sessions yet.</p>'
            : sessions.map(function (s) {
                var d = new Date(s.startedAt);
                return '<div class="history-item"><span>' + d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ' · ' +
                  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + '</span><span class="dur">' + clockFmt(s.durationSeconds) + '</span></div>';
              }).join("")) +
        '</div>' +
      '</div>';

    document.getElementById("startReading").addEventListener("click", function () { openTimerSheet(b.id); });
    document.getElementById("logPast").addEventListener("click", function () { openLogSessionSheet(b.id); });

    // Star rating — saves immediately on click.
    screenEl.querySelectorAll(".star[data-star]").forEach(function (starBtn) {
      starBtn.addEventListener("click", function () {
        var val = parseInt(starBtn.getAttribute("data-star"), 10);
        updateDoc(doc(booksCol(), b.id), { rating: val }).catch(reportError);
      });
    });
    var starClear = document.getElementById("starClear");
    if (starClear) starClear.addEventListener("click", function () {
      updateDoc(doc(booksCol(), b.id), { rating: 0 }).catch(reportError);
    });

    // Review / notes — enable Save when the text changes.
    var reviewBox = document.getElementById("reviewBox");
    var saveReview = document.getElementById("saveReview");
    reviewBox.addEventListener("input", function () {
      saveReview.disabled = reviewBox.value === (b.review || "");
    });
    saveReview.addEventListener("click", function () {
      saveReview.disabled = true;
      updateDoc(doc(booksCol(), b.id), { review: reviewBox.value }).catch(reportError);
    });
  }

  function openBookMenu(b) {
    var st = bookStatus(b);
    var choice = prompt(
      "What would you like to do?\n\n" +
      "1) Move to Want to read\n" +
      "2) Move to Currently reading\n" +
      "3) Mark as finished\n" +
      "4) Update current page\n" +
      "5) Log past session\n\n" +
      "Currently: " + (st === "want" ? "Want to read" : st === "finished" ? "Finished" : "Reading") +
      "\nEnter 1–5:"
    );
    if (choice === "1") {
      updateDoc(doc(booksCol(), b.id), { status: "want", finishedAt: null }).catch(reportError);
    } else if (choice === "2") {
      updateDoc(doc(booksCol(), b.id), { status: "reading", finishedAt: null }).catch(reportError);
    } else if (choice === "3") {
      updateDoc(doc(booksCol(), b.id), { status: "finished", finishedAt: b.finishedAt || new Date().toISOString() }).catch(reportError);
    } else if (choice === "4") {
      var page = prompt("Current page:", String(b.currentPage));
      var n = parseInt(page, 10);
      if (!isNaN(n) && n >= 0) updateDoc(doc(booksCol(), b.id), { currentPage: n }).catch(reportError);
    } else if (choice === "5") {
      openLogSessionSheet(b.id);
    }
  }

  // ---------- Reading timer sheet ----------
  function openTimerSheet(bookId) {
    var b = book(bookId);
    timerState = { bookId: bookId, accumulated: 0, running: false, resumeAt: null, intervalId: null };

    function elapsed() {
      var running = timerState.resumeAt ? (Date.now() - timerState.resumeAt) / 1000 : 0;
      return Math.floor(timerState.accumulated + running);
    }

    function paint() {
      var el = sheetEl.querySelector(".timer-clock");
      if (el) el.textContent = clockFmt(elapsed());
      var doneBtn = sheetEl.querySelector(".done");
      if (doneBtn) doneBtn.disabled = elapsed() === 0;
    }

    function draw() {
      var running = timerState.running;
      sheetEl.innerHTML =
        '<button class="timer-cancel" id="timerCancel">Cancel</button>' +
        '<div class="timer-screen">' +
          '<div><h3>' + escapeHtml(b.title) + '</h3><p class="authors">' + escapeHtml(b.authors || "Unknown author") + '</p></div>' +
          '<div class="timer-clock">' + clockFmt(elapsed()) + '</div>' +
          '<div class="timer-actions">' +
            (running
              ? '<button class="pause" id="timerPause"><span class="ti">⏸</span>Pause</button>'
              : '<button class="go" id="timerStart"><span class="ti">▶</span>' + (elapsed() === 0 ? "Start" : "Resume") + '</button>') +
            '<button class="done" id="timerDone" ' + (elapsed() === 0 ? "disabled" : "") + '><span class="ti">⏹</span>Done</button>' +
          '</div>' +
        '</div>';
      document.getElementById("timerCancel").addEventListener("click", function () { stopTicking(); closeSheet(); });
      var startBtn = document.getElementById("timerStart");
      if (startBtn) startBtn.addEventListener("click", startTicking);
      var pauseBtn = document.getElementById("timerPause");
      if (pauseBtn) pauseBtn.addEventListener("click", function () { pauseTicking(); draw(); });
      document.getElementById("timerDone").addEventListener("click", function () {
        pauseTicking();
        openTimerSummary(bookId, elapsed());
      });
    }

    function startTicking() {
      timerState.resumeAt = Date.now();
      timerState.running = true;
      timerState.intervalId = setInterval(paint, 250);
      draw();
    }
    function pauseTicking() {
      if (timerState.resumeAt) timerState.accumulated += (Date.now() - timerState.resumeAt) / 1000;
      timerState.resumeAt = null;
      timerState.running = false;
      if (timerState.intervalId) clearInterval(timerState.intervalId);
      timerState.intervalId = null;
    }
    function stopTicking() { pauseTicking(); timerState = null; }

    draw();
    startTicking();
    openSheet();
  }

  function openTimerSummary(bookId, elapsedSeconds) {
    var b = book(bookId);
    sheetEl.innerHTML =
      '<div class="titlebar"><button class="action text" id="discardBtn" style="color:var(--danger);">Discard</button><h2 style="font-size:15px;">Save session</h2><button class="action text" id="saveSessionBtn" style="font-weight:700;">Save</button></div>' +
      '<div class="screen">' +
        '<div class="card" style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span>Time read</span><span style="font-variant-numeric:tabular-nums;color:var(--ink-soft);">' + clockFmt(elapsedSeconds) + '</span>' +
        '</div>' +
        '<div class="field"><label for="s-pages">Pages read this session</label><input id="s-pages" inputmode="numeric" placeholder="Optional" /></div>' +
        '<div class="field"><label for="s-current">Current page</label><input id="s-current" inputmode="numeric" value="' + b.currentPage + '" /></div>' +
      '</div>';
    document.getElementById("discardBtn").addEventListener("click", function () { timerState = null; closeSheet(); });
    document.getElementById("saveSessionBtn").addEventListener("click", async function () {
      var end = new Date();
      var start = new Date(end.getTime() - elapsedSeconds * 1000);
      var pagesRead = parseInt(document.getElementById("s-pages").value, 10);
      var newPage = parseInt(document.getElementById("s-current").value, 10);
      try {
        await addDoc(sessionsCol(), {
          bookId: bookId, startedAt: start.toISOString(), durationSeconds: elapsedSeconds,
          pagesRead: isNaN(pagesRead) ? 0 : pagesRead, dayKey: dayKey(start)
        });
        var updates = {};
        if (!isNaN(newPage) && newPage >= 0) {
          updates.currentPage = newPage;
          if (b.pageCount > 0 && newPage >= b.pageCount) { updates.finishedAt = end.toISOString(); updates.status = "finished"; }
        }
        // Logging time against a wishlist book means you've started it.
        if (bookStatus(b) === "want" && updates.status !== "finished") updates.status = "reading";
        if (Object.keys(updates).length) await updateDoc(doc(booksCol(), bookId), updates);
      } catch (err) { reportError(err); }
      timerState = null;
      closeSheet();
    });
  }

  // ---------- Manual "log past session" sheet ----------
  function openLogSessionSheet(bookId) {
    var b = book(bookId);
    var now = new Date();
    var localVal = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") +
      "T" + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

    sheetEl.innerHTML =
      '<div class="titlebar"><button class="action text" id="cancelLog">Cancel</button><h2 style="font-size:15px;">Log Past Session</h2><button class="action text" id="saveLog" style="font-weight:700;">Save</button></div>' +
      '<div class="screen">' +
        '<div class="field"><label for="l-date">When did you read?</label><input id="l-date" type="datetime-local" value="' + localVal + '" max="' + localVal + '" /></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="l-hours">Hours</label><input id="l-hours" type="number" min="0" max="23" value="0" /></div>' +
          '<div class="field"><label for="l-min">Minutes</label><input id="l-min" type="number" min="0" max="59" value="30" /></div>' +
        '</div>' +
        '<div id="l-err" class="err" style="display:none;">Duration must be more than zero.</div>' +
        '<div class="field"><label for="l-pages">Pages read this session</label><input id="l-pages" inputmode="numeric" placeholder="Optional" /></div>' +
        '<div class="field"><label for="l-current">Current page after reading</label><input id="l-current" inputmode="numeric" placeholder="Optional" /></div>' +
        (b.finishedAt ? "" : '<div class="checkbox-row"><input type="checkbox" id="l-finish" /><label for="l-finish">Mark book finished on this date</label></div>') +
      '</div>';

    document.getElementById("cancelLog").addEventListener("click", closeSheet);
    document.getElementById("saveLog").addEventListener("click", async function () {
      var hours = parseInt(document.getElementById("l-hours").value, 10) || 0;
      var minutes = parseInt(document.getElementById("l-min").value, 10) || 0;
      var totalSeconds = hours * 3600 + minutes * 60;
      if (totalSeconds <= 0) { document.getElementById("l-err").style.display = "block"; return; }
      var when = new Date(document.getElementById("l-date").value);
      var pagesRead = parseInt(document.getElementById("l-pages").value, 10);
      var current = parseInt(document.getElementById("l-current").value, 10);
      var finishBox = document.getElementById("l-finish");
      try {
        await addDoc(sessionsCol(), {
          bookId: bookId, startedAt: when.toISOString(), durationSeconds: totalSeconds,
          pagesRead: isNaN(pagesRead) ? 0 : pagesRead, dayKey: dayKey(when)
        });
        var updates = {};
        if (!isNaN(current) && current >= 0) updates.currentPage = current;
        if (finishBox && finishBox.checked) { updates.finishedAt = when.toISOString(); updates.status = "finished"; }
        if (bookStatus(b) === "want" && updates.status !== "finished") updates.status = "reading";
        if (Object.keys(updates).length) await updateDoc(doc(booksCol(), bookId), updates);
      } catch (err) { reportError(err); }
      closeSheet();
    });
    openSheet();
  }

  // ---------- Sheet plumbing ----------
  function openSheet() { sheetBackdrop.classList.add("open"); }
  function closeSheet() {
    sheetBackdrop.classList.remove("open");
    setTimeout(function () { sheetEl.innerHTML = ""; }, 250);
  }
  sheetBackdrop.addEventListener("click", function (e) {
    if (e.target === sheetBackdrop) {
      if (timerState) { return; } // don't dismiss an active timer by clicking outside
      closeSheet();
    }
  });

  // ---------- Goal tab ----------
  function booksFinishedInYear(year) {
    return state.books.filter(function (b) {
      return bookStatus(b) === "finished" && b.finishedAt && new Date(b.finishedAt).getFullYear() === year;
    }).length;
  }

  function renderGoal() {
    titlebarEl.innerHTML = '<h2>Goals</h2><span></span>';
    var goalMinutes = state.goal.minutesPerDay || 0;
    var today = todaySeconds();
    var progress = goalMinutes > 0 ? Math.min(1, today / (goalMinutes * 60)) : 0;
    var r = 92, c = 2 * Math.PI * r;

    var year = new Date().getFullYear();
    var booksTarget = state.goal.booksPerYear || 0;
    var doneThisYear = booksFinishedInYear(year);
    var challengeFrac = booksTarget > 0 ? Math.min(1, doneThisYear / booksTarget) : 0;

    screenEl.innerHTML =
      '<div class="ring-wrap" style="position:relative;">' +
        '<svg width="220" height="220" viewBox="0 0 220 220">' +
          '<circle cx="110" cy="110" r="' + r + '" fill="none" stroke="var(--paper-sunken)" stroke-width="16" />' +
          '<circle cx="110" cy="110" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="16" stroke-linecap="round" ' +
            'stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - progress)) + '" transform="rotate(-90 110 110)" />' +
        '</svg>' +
        '<div class="ring-center">' +
          '<span class="num">' + Math.floor(today / 60) + '</span>' +
          '<span class="of">of ' + goalMinutes + ' min today</span>' +
          (progress >= 1 ? '<span class="hit">✓ Goal hit</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<p class="section-title" style="margin-top:0;">Target minutes per day</p>' +
        '<div class="slider-row"><span>5</span><input type="range" id="goalSlider" min="5" max="180" step="5" value="' + (goalMinutes || 20) + '" /><span>180</span></div>' +
        '<div class="goal-value-row"><span class="amt" id="goalAmt">' + (goalMinutes || 20) + ' min</span>' +
        '<button class="btn small primary" id="goalSave" disabled>Save</button></div>' +
      '</div>' +
      '<div class="card">' +
        '<p class="section-title" style="margin-top:0;">' + year + ' reading challenge</p>' +
        '<div class="challenge-head"><span class="challenge-count"><strong>' + doneThisYear + '</strong> of ' + (booksTarget || "—") + ' books</span>' +
          (booksTarget > 0 && doneThisYear >= booksTarget ? '<span class="hit">✓ Challenge complete!</span>' : '') + '</div>' +
        '<div class="progress-track" style="height:8px;margin:8px 0 14px;"><span style="width:' + (challengeFrac * 100) + '%"></span></div>' +
        '<div class="stepper-row"><span>Goal for ' + year + '</span>' +
          '<div class="stepper"><button type="button" id="booksMinus">−</button>' +
          '<span id="booksVal">' + (booksTarget || 12) + '</span>' +
          '<button type="button" id="booksPlus">+</button></div>' +
          '<button class="btn small primary" id="booksSave" disabled>Save</button></div>' +
      '</div>';

    var slider = document.getElementById("goalSlider");
    var amt = document.getElementById("goalAmt");
    var saveBtn = document.getElementById("goalSave");
    slider.addEventListener("input", function () {
      amt.textContent = slider.value + " min";
      saveBtn.disabled = parseInt(slider.value, 10) === goalMinutes;
    });
    saveBtn.addEventListener("click", function () {
      setDoc(goalDocRef(), { minutesPerDay: parseInt(slider.value, 10) }, { merge: true }).catch(reportError);
    });

    var booksVal = document.getElementById("booksVal");
    var booksSave = document.getElementById("booksSave");
    var pending = booksTarget || 12;
    function refreshBooks() { booksVal.textContent = pending; booksSave.disabled = pending === booksTarget; }
    document.getElementById("booksMinus").addEventListener("click", function () { pending = Math.max(1, pending - 1); refreshBooks(); });
    document.getElementById("booksPlus").addEventListener("click", function () { pending = Math.min(365, pending + 1); refreshBooks(); });
    booksSave.addEventListener("click", function () {
      setDoc(goalDocRef(), { booksPerYear: pending }, { merge: true }).catch(reportError);
    });
  }

  // ---------- Stats tab ----------
  var statsRange = "Week";
  function renderStats() {
    titlebarEl.innerHTML = '<h2>Stats</h2><span></span>';
    var bounds = rangeBounds(statsRange);
    var buckets = dailyTotals(bounds[0], bounds[1]);
    var totalMinutes = buckets.reduce(function (a, b) { return a + Math.floor(b.seconds / 60); }, 0);
    var avgMinutes = Math.floor(totalMinutes / Math.max(1, buckets.length));
    var daysRead = buckets.filter(function (b) { return b.seconds > 0; }).length;
    var goalMinutes = state.goal.minutesPerDay || 0;
    var streak = currentStreak(Math.max(1, goalMinutes));

    var maxMinutes = Math.max(1, goalMinutes, buckets.reduce(function (m, b) { return Math.max(m, Math.floor(b.seconds / 60)); }, 0));
    var barsHtml = buildBarChart(buckets, maxMinutes, goalMinutes);

    screenEl.innerHTML =
      '<div class="segmented">' +
        ["Day", "Week", "Month", "Year"].map(function (r) {
          return '<button data-range="' + r + '" class="' + (statsRange === r ? "active" : "") + '">' + r + '</button>';
        }).join("") +
      '</div>' +
      '<div class="card" style="display:flex;">' +
        statPair("Total", totalMinutes, "min") + statPair("Average/day", avgMinutes, "min") + statPair("Days read", daysRead, "") +
      '</div>' +
      '<div class="card">' +
        '<p class="section-title" style="margin-top:0;">' + chartTitle(statsRange) + '</p>' +
        '<div class="chart-wrap">' + barsHtml + '</div>' +
      '</div>' +
      '<div class="card streak-row">' +
        '<span class="flame">🔥</span>' +
        '<div><p class="label" style="margin:0;">Current streak</p><p class="num" style="margin:2px 0;">' + streak + ' day' + (streak === 1 ? "" : "s") + '</p>' +
        (goalMinutes > 0 ? '<p class="sub">Days hitting ' + goalMinutes + ' min goal</p>' : '') + '</div>' +
      '</div>';

    screenEl.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () { statsRange = btn.getAttribute("data-range"); renderStats(); });
    });
  }
  function statPair(title, value, unit) {
    return '<div style="flex:1;text-align:center;"><p class="label" style="margin:0 0 2px;">' + title + '</p>' +
      '<p class="value" style="margin:0;">' + value + (unit ? ' <span style="font-size:11px;color:var(--ink-soft);font-weight:500;">' + unit + '</span>' : '') + '</p></div>';
  }
  function chartTitle(range) {
    return range === "Day" ? "Today" : range === "Week" ? "Last 7 days" : range === "Month" ? "Last 30 days" : "Last 12 months";
  }
  function buildBarChart(buckets, maxMinutes, goalMinutes) {
    var w = 300, h = 160, padTop = 10, padBottom = 4;
    var n = buckets.length;
    var gap = n > 60 ? 0.5 : 2;
    var barW = Math.max(1, (w - gap * (n - 1)) / n);
    var bars = buckets.map(function (b, i) {
      var minutes = Math.floor(b.seconds / 60);
      var barH = maxMinutes > 0 ? (minutes / maxMinutes) * (h - padTop - padBottom) : 0;
      var x = i * (barW + gap);
      var y = h - padBottom - barH;
      return '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + Math.max(0, barH).toFixed(2) +
        '" rx="' + Math.min(3, barW / 2).toFixed(1) + '" fill="var(--accent)"><title>' +
        b.date.toLocaleDateString() + ": " + minutes + " min</title></rect>";
    }).join("");
    var goalLine = "";
    if (goalMinutes > 0 && maxMinutes > 0) {
      var y = h - padBottom - (goalMinutes / maxMinutes) * (h - padTop - padBottom);
      goalLine = '<line x1="0" y1="' + y.toFixed(2) + '" x2="' + w + '" y2="' + y.toFixed(2) + '" stroke="var(--flame)" stroke-width="1.5" stroke-dasharray="4 3" />';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="height:160px;">' + bars + goalLine + '</svg>';
  }

  // ---------- sample data (adds alongside whatever already exists) ----------
  async function addSampleBooks() {
    var now = new Date();
    var defs = [
      { title: "The Pragmatic Programmer", authors: "Andrew Hunt, David Thomas", pageCount: 352 },
      { title: "Designing Data-Intensive Applications", authors: "Martin Kleppmann", pageCount: 616 },
      { title: "The Three-Body Problem", authors: "Liu Cixin", pageCount: 400 }
    ];
    try {
      for (var idx = 0; idx < defs.length; idx++) {
        var def = defs[idx];
        var addedAt = addDays(now, -idx * 3).toISOString();
        var current = Math.floor(Math.random() * (Math.max(20, def.pageCount - 20) - 10 + 1)) + 10;
        var bookRef = await addDoc(booksCol(), {
          title: def.title, authors: def.authors, pageCount: def.pageCount,
          currentPage: current, addedAt: addedAt, finishedAt: null
        });
        for (var d = 0; d < 5; d++) {
          var start = new Date(addDays(now, -d).getTime() + idx * 20 * 60 * 1000);
          var duration = Math.floor(Math.random() * (2400 - 600 + 1)) + 600;
          await addDoc(sessionsCol(), {
            bookId: bookRef.id, startedAt: start.toISOString(), durationSeconds: duration,
            pagesRead: Math.floor(Math.random() * 26) + 5, dayKey: dayKey(start)
          });
        }
      }
      if (!(state.goal && state.goal.minutesPerDay > 0)) {
        await setDoc(goalDocRef(), { minutesPerDay: 30 }, { merge: true });
      }
    } catch (err) { reportError(err); }
  }

  // ---------- auth wiring ----------
  var authLoadingEl = document.getElementById("authLoading");
  var authScreenEl = document.getElementById("authScreen");
  var appRootEl = document.getElementById("appRoot");
  var authForm = document.getElementById("authForm");
  var authTitle = document.getElementById("authTitle");
  var authSubmit = document.getElementById("authSubmit");
  var authSwitchLabel = document.getElementById("authSwitchLabel");
  var authSwitchBtn = document.getElementById("authSwitchBtn");
  var authError = document.getElementById("authError");
  var authMode = "signin";

  function setAuthMode(mode) {
    authMode = mode;
    if (mode === "signin") {
      authTitle.textContent = "Sign in";
      authSubmit.textContent = "Sign in";
      authSwitchLabel.textContent = "Don't have an account?";
      authSwitchBtn.textContent = "Create one";
    } else {
      authTitle.textContent = "Create your account";
      authSubmit.textContent = "Create account";
      authSwitchLabel.textContent = "Already have an account?";
      authSwitchBtn.textContent = "Sign in";
    }
    authError.style.display = "none";
  }
  authSwitchBtn.addEventListener("click", function () { setAuthMode(authMode === "signin" ? "signup" : "signin"); });

  function friendlyAuthError(err) {
    var code = err && err.code;
    var map = {
      "auth/invalid-email": "That email address doesn't look right.",
      "auth/user-not-found": "No account with that email. Try creating one.",
      "auth/wrong-password": "Wrong password.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/email-already-in-use": "An account already exists with that email — try signing in instead.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
      "auth/operation-not-allowed": "That sign-in method isn't turned on for this project. Use email and password, or enable it in Firebase Authentication.",
      "auth/unauthorized-domain": "This domain isn't authorized for sign-in yet — add it in Firebase Auth settings."
    };
    return (code && map[code]) || (err && err.message) || "Something went wrong.";
  }

  authForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("authEmail").value.trim();
    var password = document.getElementById("authPassword").value;
    authError.style.display = "none";
    var action = authMode === "signin" ? signInWithEmailAndPassword : createUserWithEmailAndPassword;
    action(auth, email, password).catch(function (err) {
      authError.textContent = friendlyAuthError(err);
      authError.style.display = "block";
    });
  });

  document.getElementById("googleBtn").addEventListener("click", function () {
    authError.style.display = "none";
    signInWithPopup(auth, googleProvider).catch(function (err) {
      authError.textContent = friendlyAuthError(err);
      authError.style.display = "block";
    });
  });

  document.getElementById("signOutBtn").addEventListener("click", function () { signOut(auth); });
  document.getElementById("sampleBtn").addEventListener("click", function () { addSampleBooks(); });

  onAuthStateChanged(auth, function (user) {
    authLoadingEl.style.display = "none";
    if (user) {
      currentUser = user;
      authScreenEl.style.display = "none";
      appRootEl.style.display = "flex";
      document.getElementById("accountNote").textContent = user.email || "Signed in";
      nav = { tab: "library", filter: "reading", bookId: null };
      attachListeners();
      renderAll();
    } else {
      detachListeners();
      currentUser = null;
      appRootEl.style.display = "none";
      authScreenEl.style.display = "flex";
    }
  });
})();
