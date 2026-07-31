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
  function renderLibrary() {
    titlebarEl.innerHTML =
      '<h2>Library</h2>' +
      '<button class="action" id="addBtn" aria-label="Add book">＋</button>';
    document.getElementById("addBtn").addEventListener("click", openAddBookSheet);

    var list = state.books.filter(function (b) {
      return nav.filter === "reading" ? !b.finishedAt : !!b.finishedAt;
    }).sort(function (a, b) { return new Date(b.addedAt) - new Date(a.addedAt); });

    var html = '<div class="segmented">' +
      ["reading", "finished"].map(function (f) {
        return '<button data-filter="' + f + '" class="' + (nav.filter === f ? "active" : "") + '">' + (f === "reading" ? "Reading" : "Finished") + '</button>';
      }).join("") + '</div>';

    if (list.length === 0) {
      html += '<div class="empty"><div class="glyph">📖</div>' +
        (nav.filter === "reading"
          ? '<strong>Your shelf is empty</strong><span>Tap ＋ to add the books you\'re reading.</span>'
          : '<strong>Nothing finished yet</strong><span>Books you mark finished will show up here.</span>') +
        '</div>';
    } else {
      html += '<div class="book-grid">' + list.map(function (b) {
        var frac = progressFraction(b);
        return '<div class="row" data-open="' + b.id + '">' +
          '<button class="row-del" data-del="' + b.id + '" aria-label="Delete">✕</button>' +
          '<div class="cover" style="background:' + coverColor(b.id) + '">' + escapeHtml(initials(b.title)) + '</div>' +
          '<div class="row-body">' +
            '<p class="row-title">' + escapeHtml(b.title) + '</p>' +
            '<p class="row-author">' + escapeHtml(b.authors || "Unknown author") + '</p>' +
            (b.pageCount > 0
              ? '<div class="progress-line"><div class="progress-track"><span style="width:' + (frac * 100) + '%"></span></div>' +
                '<span class="pages">' + b.currentPage + '/' + b.pageCount + '</span></div>'
              : '') +
          '</div>' +
        '</div>';
      }).join("") + '</div>';
    }
    screenEl.innerHTML = html;

    screenEl.querySelectorAll("[data-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () { nav.filter = btn.getAttribute("data-filter"); renderLibrary(); });
    });
    screenEl.querySelectorAll("[data-open]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("[data-del]")) return;
        nav.bookId = row.getAttribute("data-open");
        renderAll();
      });
    });
    screenEl.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = btn.getAttribute("data-del");
        if (confirm("Remove this book and its reading history? This can't be undone.")) {
          deleteBook(id);
        }
      });
    });
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

  function openAddBookSheet() {
    sheetEl.innerHTML =
      '<div class="titlebar"><button class="action text" id="cancelAdd">Cancel</button><h2>Add Book</h2><button class="action text" id="saveAdd" style="font-weight:700;">Save</button></div>' +
      '<div class="screen">' +
        '<div class="field"><label for="f-title">Title</label><input id="f-title" placeholder="e.g. Klara and the Sun" /></div>' +
        '<div class="field"><label for="f-authors">Authors</label><input id="f-authors" placeholder="Comma-separated" /></div>' +
        '<div class="field"><label for="f-pages">Page count (optional)</label><input id="f-pages" inputmode="numeric" placeholder="e.g. 320" /></div>' +
      '</div>';
    document.getElementById("cancelAdd").addEventListener("click", closeSheet);
    var titleInput = document.getElementById("f-title");
    var saveBtn = document.getElementById("saveAdd");
    function refreshDisabled() { saveBtn.style.opacity = titleInput.value.trim() ? "1" : "0.4"; }
    titleInput.addEventListener("input", refreshDisabled);
    refreshDisabled();
    saveBtn.addEventListener("click", function () {
      var title = titleInput.value.trim();
      if (!title) return;
      var authors = document.getElementById("f-authors").value.trim();
      var pages = parseInt(document.getElementById("f-pages").value, 10);
      addDoc(booksCol(), {
        title: title, authors: authors, pageCount: isNaN(pages) ? 0 : pages,
        currentPage: 0, addedAt: new Date().toISOString(), finishedAt: null
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
    var sessions = sessionsFor(b.id).slice().sort(function (a, c) { return new Date(c.startedAt) - new Date(a.startedAt); }).slice(0, 20);

    screenEl.innerHTML =
      '<div class="detail-grid">' +
        '<div>' +
          '<div class="book-header">' +
            '<div class="cover lg" style="background:' + coverColor(b.id) + '">' + escapeHtml(initials(b.title)) + '</div>' +
            '<div class="meta"><h3>' + escapeHtml(b.title) + '</h3><p>' + escapeHtml(b.authors || "Unknown author") + '</p>' +
            (b.finishedAt ? '<p style="color:var(--accent);font-weight:600;margin-top:6px;">✓ Finished</p>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="stat-pair">' +
              '<div><p class="label">Progress</p><p class="value">' + b.currentPage + ' / ' + (b.pageCount > 0 ? b.pageCount : "—") + '</p></div>' +
              '<div class="right"><p class="label">Total time</p><p class="value">' + clockFmt(total) + '</p></div>' +
            '</div>' +
            '<div class="progress-track" style="height:6px;"><span style="width:' + (frac * 100) + '%"></span></div>' +
            '<button class="btn primary" id="startReading">▶ Start reading</button>' +
            '<button class="btn secondary" id="logPast">🗓 Log past session</button>' +
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
  }

  function openBookMenu(b) {
    var choice = prompt(
      (b.finishedAt ? "1) Mark as reading\n" : "1) Mark as finished\n") +
      "2) Update current page\n3) Log past session\n\nEnter 1, 2, or 3:"
    );
    if (choice === "1") {
      updateDoc(doc(booksCol(), b.id), { finishedAt: b.finishedAt ? null : new Date().toISOString() }).catch(reportError);
    } else if (choice === "2") {
      var page = prompt("Current page:", String(b.currentPage));
      var n = parseInt(page, 10);
      if (!isNaN(n) && n >= 0) updateDoc(doc(booksCol(), b.id), { currentPage: n }).catch(reportError);
    } else if (choice === "3") {
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
        if (!isNaN(newPage) && newPage >= 0) {
          var updates = { currentPage: newPage };
          if (b.pageCount > 0 && newPage >= b.pageCount) updates.finishedAt = end.toISOString();
          await updateDoc(doc(booksCol(), bookId), updates);
        }
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
        if (finishBox && finishBox.checked) updates.finishedAt = when.toISOString();
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
  function renderGoal() {
    titlebarEl.innerHTML = '<h2>Daily Goal</h2><span></span>';
    var goalMinutes = state.goal.minutesPerDay || 0;
    var today = todaySeconds();
    var progress = goalMinutes > 0 ? Math.min(1, today / (goalMinutes * 60)) : 0;
    var r = 92, c = 2 * Math.PI * r;

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
