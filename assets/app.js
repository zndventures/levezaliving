/* LEVEZA — site logic: language, routing, registration, closed part, admin */
(function () {
  'use strict';
  var I = window.LZ_I18N || { en: {} }, CFG = window.LZ_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- language ---------------- */
  var lang = store('lz_lang');
  if (!I[lang]) { var nl = (navigator.language || 'en').slice(0, 2).toLowerCase(); lang = I[nl] ? nl : 'en'; }
  function t(k, vars) {
    var s = (I[lang] && I[lang][k] != null) ? I[lang][k] : (I.en[k] != null ? I.en[k] : k);
    if (vars) for (var v in vars) s = s.split('{' + v + '}').join(esc(vars[v]));
    return s;
  }
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-t]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-t')); });
    $$('.langs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === lang); });
    if (state.sent) $('#signup-sent-text').innerHTML = t('sent.' + state.sent.role, { email: state.sent.email });
  }

  /* ---------------- backend ---------------- */
  var state = { tab: null, profile: null, sent: null, view: 'home' };
  var api = window.LZ_DEMO_API || null;
  var redirectTo = location.origin + location.pathname + '?v=acesso';
  if (!api && CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase) {
    var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    api = {
      session: function () { return sb.auth.getSession().then(function (r) { return r.data ? r.data.session : null; }); },
      onAuth: function (cb) { sb.auth.onAuthStateChange(function (ev) { cb(ev); }); },
      signUp: function (d) {
        return sb.auth.signInWithOtp({ email: d.email, options: { emailRedirectTo: redirectTo,
          data: { full_name: d.name, role: d.role, country: d.country, message: d.message, lang: lang, consent: 'true' } } })
          .then(function (r) { return { error: r.error }; });
      },
      login: function (email) {
        return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } })
          .then(function (r) { return { error: r.error }; });
      },
      profile: function (uid) { return sb.from('profiles').select('*').eq('id', uid).maybeSingle().then(function (r) { return r.data || null; }); },
      content: function (aud, lg, page) {
        return sb.from('private_content').select('lang,html,sort').eq('audience', aud).eq('page', page || 'main').in('lang', [lg, 'en']).order('sort')
          .then(function (r) {
            var rows = r.data || [], own = rows.filter(function (x) { return x.lang === lg; });
            if (!own.length) own = rows.filter(function (x) { return x.lang === 'en'; });
            return own.length ? own.map(function (x) { return x.html; }).join('') : null;
          });
      },
      signed: function (path) { return sb.storage.from('private').createSignedUrl(path, 3600).then(function (r) { return r.data ? r.data.signedUrl : null; }); },
      markSeen: function () { return sb.rpc('mark_investor_seen').then(function () {}, function () {}); },
      requestInvestor: function (msg) { return sb.rpc('request_investor_access', { msg: msg || null }).then(function (r) { return { error: r.error }; }); },
      list: function () { return sb.from('profiles').select('*').order('created_at', { ascending: false }).then(function (r) { return r.data || []; }); },
      setInvestor: function (id, st) { return sb.rpc('admin_set_investor_status', { target: id, new_status: st }).then(function (r) { return { error: r.error }; }); },
      setBlocked: function (id, b) { return sb.rpc('admin_set_blocked', { target: id, is_blocked: b }).then(function (r) { return { error: r.error }; }); },
      remove: function (id) { return sb.rpc('admin_delete_user', { target: id }).then(function (r) { return { error: r.error }; }); },
      logout: function () { return sb.auth.signOut(); }
    };
  }

  /* ---------------- routing ---------------- */
  var VIEWS = ['acesso', 'admin', 'privacy'];
  function route() {
    var h = decodeURIComponent(location.hash.replace('#', ''));
    var view = VIEWS.indexOf(h) >= 0 ? h : 'home';
    state.view = view;
    ['home'].concat(VIEWS).forEach(function (v) { $('#view-' + v).hidden = (v !== view); });
    if (view === 'home') {
      observe();
      var target = h && /^[a-z]+$/.test(h) ? document.getElementById(h) : null;
      if (target) target.scrollIntoView(); else if (!h || h === 'top') window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, 0);
      if (view === 'acesso') renderAccess();
      if (view === 'admin') renderAdmin();
    }
  }
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.08 }) : null;
  function observe() { $$('.rv:not(.in)').forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); }); }

  /* ---------------- registration ---------------- */
  function initSignup() {
    var form = $('#signup'), err = $('.err', form), btn = $('button[type=submit]', form);
    /* any link or button with data-role switches the form between buyer and investor */
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-role]') : null; if (!a) return;
      form.role.value = a.getAttribute('data-role') === 'investor' ? 'investor' : 'buyer';
      $('#register').classList.toggle('inv', form.role.value === 'investor');
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.hidden = true;
      var d = { name: form.name.value.trim(), email: form.email.value.trim().toLowerCase(), role: form.role.value,
        country: '', message: form.role.value === 'investor' ? form.message.value.trim() : '' };
      if (!d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) || !form.consent.checked) { err.textContent = t('f.err.required'); err.hidden = false; return; }
      function done() { state.sent = { role: d.role, email: d.email }; form.hidden = true; $('#signup-sent').hidden = false; applyLang(); }
      if (form.website.value) { done(); return; }               /* honeypot: bots fill this in */
      if (!api) { err.textContent = t('f.err.config'); err.hidden = false; return; }
      var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = t('f.sending');
      api.signUp(d).then(function (r) {
        btn.disabled = false; btn.innerHTML = label;
        if (r && r.error) { err.textContent = t('f.err.generic'); err.hidden = false; return; }
        done();
      }, function () { btn.disabled = false; btn.innerHTML = label; err.textContent = t('f.err.generic'); err.hidden = false; });
    });
  }

  /* ---------------- closed part ---------------- */
  function renderLogin(box) {
    box.innerHTML = '<h2 class="display">' + t('login.h') + '</h2><p class="body">' + t('login.p') + '</p>' +
      '<form class="form login-box" novalidate><label><span>' + t('f.email') + '</span><input name="email" type="email" autocomplete="email" required></label>' +
      '<p class="err" role="status" hidden></p><button class="btn" type="submit">' + t('login.submit') + '</button></form>' +
      '<p class="note">' + t('login.new') + '</p>';
    var f = $('form', box), msg = $('.err', f);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = f.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
      var b = $('button', f); b.disabled = true;
      var fin = function () { b.disabled = false; msg.textContent = t('login.sent'); msg.hidden = false; };
      api.login(email).then(fin, fin);        /* same answer whether or not the address exists */
    });
  }
  function renderAccess() {
    var box = $('#acesso');
    if (!api) { box.innerHTML = '<p class="body">' + t('f.err.config') + '</p>'; return; }
    box.innerHTML = '<p class="note">' + t('acc.loading') + '</p>';
    api.session().then(function (s) {
      if (state.view !== 'acesso') return;
      if (!s) { state.profile = null; renderLogin(box); return; }
      return api.profile(s.user.id).then(function (p) {
        state.profile = p;
        var out = '<a href="#" data-logout>' + t('acc.logout') + '</a>';
        if (!p || p.blocked) { box.innerHTML = '<p class="body">' + t(p ? 'acc.blocked' : 'acc.error') + '</p><p class="note">' + out + '</p>'; bindLogout(box); return; }
        var first = (p.full_name || '').split(' ')[0];
        var canInv = p.is_admin || p.investor_status === 'approved';
        if (!state.tab) state.tab = canInv && p.role === 'investor' ? 'investor' : 'buyer';
        box.innerHTML = '<div class="acc-head"><h2 class="display">' + (first ? t('acc.hello', { name: first }) : t('acc.hello0')) + '</h2>' +
          '<div class="who">' + esc(p.email) + '<br>' + (p.is_admin ? '<a href="#admin">Beheer</a> · ' : '') + out + '</div></div>' +
          '<div class="tabs" role="tablist"><button type="button" data-tab="buyer">' + t('tab.buyers') + '</button><button type="button" data-tab="dentro">' + t('tab.dentro') + '</button><button type="button" data-tab="investor">' + t('tab.investors') + '</button></div>' +
          '<div class="panel" id="panel"></div>';
        bindLogout(box);
        $$('[data-tab]', box).forEach(function (b) { b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); showTab(); }); });
        showTab();
      });
    }).catch(function () { box.innerHTML = '<p class="body">' + t('acc.error') + '</p>'; });
  }
  function bindLogout(box) {
    $$('[data-logout]', box).forEach(function (a) {
      a.addEventListener('click', function (ev) { ev.preventDefault(); state.tab = null; Promise.resolve(api.logout()).then(renderAccess, renderAccess); });
    });
  }
  function showTab() {
    var p = state.profile, panel = $('#panel'); if (!panel || !p) return;
    $$('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === state.tab); });
    if (state.tab === 'investor' && !(p.is_admin || p.investor_status === 'approved')) {
      if (p.investor_status === 'pending') panel.innerHTML = '<div class="notice"><h3>' + t('pend.h') + '</h3><p>' + t('pend.p') + '</p></div>';
      else if (p.investor_status === 'declined') panel.innerHTML = '<div class="notice"><p>' + t('decl.p') + '</p></div>';
      else {
        panel.innerHTML = '<div class="notice"><h3>' + t('reqinv.h') + '</h3><p>' + t('reqinv.p') + '</p>' +
          '<textarea rows="3" maxlength="1000" placeholder="' + esc(t('f.msg')) + '"></textarea><button class="btn" type="button">' + t('reqinv.btn') + '</button></div>';
        $('button', panel).addEventListener('click', function () {
          this.disabled = true;
          api.requestInvestor($('textarea', panel).value.trim()).then(renderAccess, renderAccess);
        });
      }
      return;
    }
    var tab = state.tab, aud = tab === 'investor' ? 'investor' : 'buyer', lg = lang;
    panel.innerHTML = '<p class="note">' + t('acc.loading') + '</p>';
    api.content(aud, lg, tab === 'dentro' ? 'dentro' : 'main').then(function (html) {
      if (state.tab !== tab || lang !== lg || !$('#panel')) return;
      panel.innerHTML = html || '<p class="body">' + t('acc.empty') + '</p>';
      resolvePrivate(panel);
      if (html && aud === 'investor' && !p.is_admin && !p.investor_seen_at && api.markSeen) { p.investor_seen_at = true; api.markSeen(); }
    }, function () { panel.innerHTML = '<p class="body">' + t('acc.empty') + '</p>'; });
  }
  /* files in the private bucket: swap data-private="path" for a short-lived signed link */
  function resolvePrivate(root) {
    var els = $$('[data-private]', root), paths = {};
    els.forEach(function (el) { paths[el.getAttribute('data-private')] = null; });
    Promise.all(Object.keys(paths).map(function (p) {
      return api.signed(p).then(function (u) { paths[p] = u; }, function () { paths[p] = null; });
    })).then(function () {
      els.forEach(function (el) {
        var u = paths[el.getAttribute('data-private')];
        if (!u) { var o = el.closest('[data-optional]') || el; if (o.parentNode) o.parentNode.removeChild(o); return; }
        if (el.tagName === 'IMG') { el.loading = 'lazy'; el.src = u; } else el.href = u;
      });
      $$('[data-optional-group]', root).forEach(function (g) { if (!$('[data-private]', g)) g.parentNode.removeChild(g); });
    });
  }

  /* ---------------- admin (Dutch, for the owners) ---------------- */
  function renderAdmin() {
    var box = $('#admin');
    if (!api) { box.innerHTML = '<p class="body">Nog niet gekoppeld.</p>'; return; }
    box.innerHTML = '<p class="note">Een ogenblik…</p>';
    api.session().then(function (s) {
      if (!s) { location.hash = '#acesso'; return; }
      return api.profile(s.user.id).then(function (p) {
        if (!p || !p.is_admin) { box.innerHTML = '<p class="body">Geen toegang.</p>'; return; }
        return api.list().then(function (rows) {
          var pend = rows.filter(function (r) { return r.investor_status === 'pending'; }).length;
          var d = function (x) { return x ? new Date(x).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
          var h = '<h2 class="display">Inschrijvingen</h2><p class="body">' + rows.length + ' inschrijvingen · <b>' + pend + '</b> investeerder(s) wachten op goedkeuring. ' +
            'Na goedkeuren kun je met "Stuur link" een inlogmail sturen. "Verwijderen" wist het account en alle gegevens van die persoon definitief. <a href="#acesso">Naar de besloten kant</a></p>' +
            '<div class="tblwrap"><table class="adm"><tr><th>Naam</th><th>Type</th><th>Investeerder</th><th>Land · taal</th><th>Ingeschreven</th><th>Bevestigd</th><th>Bericht</th><th>Actie</th></tr>';
          rows.forEach(function (r) {
            h += '<tr data-id="' + esc(r.id) + '" data-email="' + esc(r.email) + '"><td><b>' + esc(r.full_name || '—') + '</b><br>' + esc(r.email) + (r.blocked ? '<br><span class="pill pending">geblokkeerd</span>' : '') + '</td>' +
              '<td>' + (r.role === 'investor' ? 'Investeerder' : 'Koper') + '</td>' +
              '<td><span class="pill ' + esc(r.investor_status) + '">' + ({ none: '—', pending: 'wacht', approved: 'toegelaten', declined: 'afgewezen' }[r.investor_status] || '') + '</span></td>' +
              '<td>' + esc(r.country || '—') + ' · ' + esc((r.lang || '').toUpperCase()) + '</td><td>' + d(r.created_at) + '</td><td>' + d(r.confirmed_at) + '</td>' +
              '<td><div class="m">' + esc(r.message || '') + '</div></td><td>' +
              (r.investor_status !== 'approved' && r.role === 'investor' ? '<button class="go" data-act="approved">Goedkeuren</button>' : '') +
              (r.investor_status === 'pending' || r.investor_status === 'approved' ? '<button data-act="declined">' + (r.investor_status === 'approved' ? 'Intrekken' : 'Afwijzen') + '</button>' : '') +
              '<button data-act="link">Stuur link</button><button data-act="' + (r.blocked ? 'unblock' : 'block') + '">' + (r.blocked ? 'Deblokkeren' : 'Blokkeren') + '</button>' +
              (r.id !== p.id && !r.is_admin ? '<button class="del" data-act="delete">Verwijderen</button>' : '') + '</td></tr>';
          });
          box.innerHTML = h + '</table></div>';
          $$('button[data-act]', box).forEach(function (b) {
            b.addEventListener('click', function () {
              var tr = b.closest('tr'), id = tr.getAttribute('data-id'), act = b.getAttribute('data-act');
              if (act === 'delete' && !b.getAttribute('data-armed')) {          /* first click arms the button, second click deletes */
                b.setAttribute('data-armed', '1'); b.classList.add('danger'); b.textContent = 'Zeker weten? Definitief verwijderen';
                setTimeout(function () { if (b.isConnected && !b.disabled) { b.removeAttribute('data-armed'); b.classList.remove('danger'); b.textContent = 'Verwijderen'; } }, 6000);
                return;
              }
              b.disabled = true;
              var pr = act === 'delete' ? api.remove(id) : act === 'link' ? api.login(tr.getAttribute('data-email')) : act === 'block' ? api.setBlocked(id, true) : act === 'unblock' ? api.setBlocked(id, false) : api.setInvestor(id, act);
              pr.then(function (r) {
                if (r && r.error) { b.disabled = false; b.textContent = 'Mislukt'; return; }
                if (act === 'link') { b.textContent = 'Verstuurd'; return; }
                renderAdmin();
              });
            });
          });
        });
      });
    }).catch(function () { box.innerHTML = '<p class="body">Laden mislukt.</p>'; });
  }

  /* ---------------- start ---------------- */
  $$('.langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang'); store('lz_lang', lang); applyLang();
      if (state.view === 'acesso') renderAccess();
    });
  });
  window.addEventListener('scroll', function () { $('#nav').classList.toggle('scrolled', window.scrollY > 10); }, { passive: true });
  window.addEventListener('hashchange', route);
  applyLang(); initSignup();
  if (api && api.onAuth) api.onAuth(function (ev) { if (ev === 'SIGNED_OUT' && state.view !== 'home') route(); });

  var fromMail = /[?&]v=acesso/.test(location.search);
  if (fromMail && api) {
    /* arriving from the e-mail link: let the session settle, then tidy the address bar */
    $('#view-home').hidden = true; $('#view-acesso').hidden = false; state.view = 'acesso';
    $('#acesso').innerHTML = '<p class="note">' + t('acc.loading') + '</p>';
    var go = function () { history.replaceState(null, '', location.pathname + '#acesso'); route(); };
    api.session().then(go, go);
  } else route();
})();
