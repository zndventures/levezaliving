/* LEVEZA — site logic: language, routing, registration, closed part, admin */
(function () {
  'use strict';
  var I = window.LZ_I18N || { en: {} }, CFG = window.LZ_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var noop = function () {};

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

  /* ---------------- spam protection (Cloudflare Turnstile; only active once a site key is set in config.js) ---------------- */
  var turnstile = null;
  function captcha() {
    if (!CFG.turnstileSiteKey) return Promise.resolve(undefined);
    if (!turnstile) turnstile = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.async = true;
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.onload = function () { res(window.turnstile); };
      s.onerror = function () { turnstile = null; rej(new Error('captcha unavailable')); };
      document.head.appendChild(s);
    });
    return turnstile.then(function (ts) {
      return new Promise(function (res, rej) {
        var box = document.getElementById('lz-captcha');
        if (!box) { box = document.createElement('div'); box.id = 'lz-captcha'; document.body.appendChild(box); }
        var holder = document.createElement('div'); box.appendChild(holder);
        var id = ts.render(holder, { sitekey: CFG.turnstileSiteKey, appearance: 'interaction-only', language: lang,
          callback: function (token) { res(token); setTimeout(function () { try { ts.remove(id); } catch (e) {} if (holder.parentNode) holder.parentNode.removeChild(holder); }, 800); },
          'error-callback': function () { rej(new Error('captcha failed')); if (holder.parentNode) holder.parentNode.removeChild(holder); } });
      });
    });
  }

  /* ---------------- backend ---------------- */
  var state = { tab: null, profile: null, sent: null, view: 'home' };
  var api = window.LZ_DEMO_API || null;
  var redirectTo = location.origin + location.pathname + '?v=acesso';
  if (!api && CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase) {
    var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    var err = function (r) { return { error: r.error }; };
    api = {
      session: function () { return sb.auth.getSession().then(function (r) { return r.data ? r.data.session : null; }); },
      onAuth: function (cb) { sb.auth.onAuthStateChange(function (ev) { cb(ev); }); },
      signUp: function (d) {
        return captcha().then(function (token) {
          return sb.auth.signInWithOtp({ email: d.email, options: { emailRedirectTo: redirectTo, captchaToken: token,
            data: { full_name: d.name, role: d.role, country: d.country, message: d.message, lang: lang, consent: 'true' } } });
        }).then(err);
      },
      login: function (email) {
        return captcha().then(function (token) {
          return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false, captchaToken: token } });
        }).then(err);
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
      markSeen: function () { return sb.rpc('mark_investor_seen').then(noop, noop); },
      requestInvestor: function (msg) { return sb.rpc('request_investor_access', { msg: msg || null }).then(err); },
      requestContact: function (kind, phone, note) { return sb.rpc('request_contact', { k: kind, ph: phone || null, nt: note || null }).then(err); },
      track: function (d) { return sb.rpc('track', d).then(noop, noop); },
      /* admin */
      list: function () { return sb.from('profiles').select('*').order('created_at', { ascending: false }).then(function (r) { return r.data || []; }); },
      stats: function (days) { return sb.rpc('admin_stats', { days: days }).then(function (r) { return r.error ? null : r.data; }); },
      requests: function () {
        return sb.from('contact_requests').select('id,kind,phone,note,created_at,profiles(full_name,email)').is('handled_at', null).order('created_at', { ascending: false })
          .then(function (r) { return r.data || []; });
      },
      handleRequest: function (id) { return sb.rpc('admin_handle_request', { rid: id }).then(err); },
      setInvestor: function (id, st) { return sb.rpc('admin_set_investor_status', { target: id, new_status: st }).then(err); },
      setBlocked: function (id, b) { return sb.rpc('admin_set_blocked', { target: id, is_blocked: b }).then(err); },
      remove: function (id) { return sb.rpc('admin_delete_user', { target: id }).then(err); },
      logout: function () { return sb.auth.signOut(); }
    };
  }

  /* ---------------- counting visits: no cookies, no IP address, nothing that identifies a person ---------------- */
  function track(ev, role) {
    try {
      if (!api || !api.track || store('lz_notrack')) return;
      var ref = '', tz = '', w = window.innerWidth;
      try { var u = document.referrer ? new URL(document.referrer) : null; if (u && u.host !== location.host) ref = u.host.replace(/^www\./, ''); } catch (e) {}
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
      api.track({ ev: ev, lg: lang, rf: ref, dv: w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop', zone: tz, rl: role || null });
    } catch (e) {}
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
    var born = Date.now(), touched = false;
    var touch = function () { if (!touched) { touched = true; track('form_start', form.role.value); } };
    ['focusin', 'pointerdown', 'keydown'].forEach(function (e) { form.addEventListener(e, touch); });
    /* any link or button with data-role switches the form between buyer and investor */
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('[data-role]') : null; if (!a) return;
      form.role.value = a.getAttribute('data-role') === 'investor' ? 'investor' : 'buyer';
      $('#register').classList.toggle('inv', form.role.value === 'investor');
      track('cta', form.role.value);
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.hidden = true;
      var d = { name: form.name.value.trim(), email: form.email.value.trim().toLowerCase(), role: form.role.value,
        country: '', message: form.role.value === 'investor' ? form.message.value.trim() : '' };
      if (!d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) || !form.consent.checked) { err.textContent = t('f.err.required'); err.hidden = false; return; }
      function done() { state.sent = { role: d.role, email: d.email }; form.hidden = true; $('#signup-sent').hidden = false; applyLang(); }
      /* simple bot traps: a hidden field people never see, a form sent within moments of loading, a form nobody touched */
      if (form.website.value || Date.now() - born < 2500 || !touched) { done(); return; }
      if (!api) { err.textContent = t('f.err.config'); err.hidden = false; return; }
      var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = t('f.sending');
      var fail = function () { btn.disabled = false; btn.innerHTML = label; err.textContent = t('f.err.generic'); err.hidden = false; };
      api.signUp(d).then(function (r) {
        if (r && r.error) return fail();
        btn.disabled = false; btn.innerHTML = label;
        track('signup', d.role); done();
      }, fail);
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
        if (p.is_admin) store('lz_notrack', '1');          /* the owners' own visits are not counted on this device */
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
      if (html && tab === 'buyer' && api.requestContact) nextStep(panel);
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
  /* the next step for a buyer: ask for a call or a visit */
  function nextStep(root) {
    var disc = $('.disc', root), box = document.createElement('div');
    box.innerHTML = '<h3 class="sub">' + t('next.h') + '</h3><p class="body">' + t('next.p') + '</p>' +
      '<form class="form nextform" novalidate><fieldset>' +
      '<label class="radio"><input type="radio" name="kind" value="call" checked><span>' + t('next.call') + '</span></label>' +
      '<label class="radio"><input type="radio" name="kind" value="visit"><span>' + t('next.visit') + '</span></label></fieldset>' +
      '<label><span>' + t('next.phone') + '</span><input name="phone" type="text" inputmode="tel" autocomplete="tel" maxlength="30"></label>' +
      '<label><span>' + t('next.note') + '</span><textarea name="note" rows="2" maxlength="600"></textarea></label>' +
      '<p class="err" role="alert" hidden></p><button class="btn" type="submit">' + t('next.send') + '</button>' +
      '<p class="invline">' + t('next.or') + '</p></form>';
    if (disc && disc.parentNode) disc.parentNode.insertBefore(box, disc); else root.appendChild(box);
    var f = $('form', box);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = $('button', f), msg = $('.err', f); msg.hidden = true; b.disabled = true;
      var fail = function () { b.disabled = false; msg.textContent = t('f.err.generic'); msg.hidden = false; };
      api.requestContact(f.kind.value, f.phone.value.trim(), f.note.value.trim()).then(function (r) {
        if (r && r.error) return fail();
        f.outerHTML = '<div class="notice" style="margin-top:24px"><h3>' + t('next.done.h') + '</h3><p>' + t('next.done.p') + '</p></div>';
      }, fail);
    });
  }

  /* ---------------- admin (Dutch, for the owners) ---------------- */
  var day = function (x) { return x ? new Date(x).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  function statsHtml(s) {
    if (!s) return '<p class="note">Bezoekcijfers zijn nog niet beschikbaar.</p>';
    var e = s.events || {}, n = function (k) { return e[k] || 0; };
    var h = '<p class="note">Laatste ' + s.days + ' dagen. Geteld zonder cookies; je eigen bezoek op dit apparaat telt niet mee.</p>' +
      '<div class="stat-tiles"><div><b>' + n('view') + '</b><span>keer de pagina bekeken</span></div><div><b>' + n('cta') + '</b><span>keer op een knop geklikt</span></div>' +
      '<div><b>' + n('form_start') + '</b><span>keer het formulier begonnen</span></div><div><b>' + (s.registered || 0) + '</b><span>inschrijvingen</span></div>' +
      '<div><b>' + (s.confirmed || 0) + '</b><span>daarvan bevestigd</span></div></div>';
    var byDay = {}, max = 1, i, d, bars = '';
    (s.by_day || []).forEach(function (r) { byDay[r.d] = r.views; if (r.views > max) max = r.views; });
    for (i = s.days - 1; i >= 0; i--) {
      d = new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
      bars += byDay[d] ? '<i title="' + d + ': ' + byDay[d] + '" style="height:' + Math.max(6, Math.round(byDay[d] / max * 100)) + '%"></i>' : '<i class="zero" title="' + d + ': 0"></i>';
    }
    h += '<div class="stat-days" role="img" aria-label="Paginaweergaven per dag">' + bars + '</div><div class="stat-axis"><span>' + s.days + ' dagen geleden</span><span>meeste op één dag: ' + max + '</span><span>vandaag</span></div>';
    var col = function (title, rows, names) {
      var x = '<div><h4>' + title + '</h4>';
      (rows || []).forEach(function (r) { x += '<div><span>' + esc((names && names[r.k]) || r.k) + '</span><span>' + r.n + '</span></div>'; });
      return x + (rows && rows.length ? '' : '<div><span>—</span><span></span></div>') + '</div>';
    };
    return h + '<div class="stat-cols">' + col('Taal', s.by_lang, { en: 'Engels', nl: 'Nederlands', pt: 'Portugees' }) + col('Komt van', s.by_ref, { direct: 'rechtstreeks' }) +
      col('Tijdzone', s.by_tz) + col('Apparaat', s.by_device, { mobile: 'telefoon', tablet: 'tablet', desktop: 'computer' }) + '</div>';
  }
  function renderAdmin() {
    var box = $('#admin');
    if (!api) { box.innerHTML = '<p class="body">Nog niet gekoppeld.</p>'; return; }
    box.innerHTML = '<p class="note">Een ogenblik…</p>';
    api.session().then(function (s) {
      if (!s) { location.hash = '#acesso'; return; }
      return api.profile(s.user.id).then(function (p) {
        if (!p || !p.is_admin) { box.innerHTML = '<p class="body">Geen toegang.</p>'; return; }
        store('lz_notrack', '1');
        var quiet = function (pr, fallback) { return pr ? pr.then(function (x) { return x; }, function () { return fallback; }) : Promise.resolve(fallback); };
        return Promise.all([api.list(), quiet(api.stats && api.stats(30), null), quiet(api.requests && api.requests(), [])]).then(function (all) {
          var rows = all[0], stats = all[1], reqs = all[2] || [];
          var pend = rows.filter(function (r) { return r.investor_status === 'pending'; }).length;
          var h = '';
          if (reqs.length) {
            h += '<h2 class="display">Aanvragen</h2><p class="body">' + reqs.length + ' open aanvraag/aanvragen voor een gesprek of bezoek.</p>' +
              '<div class="tblwrap"><table class="adm"><tr><th>Datum</th><th>Wie</th><th>Wil</th><th>Telefoon</th><th>Bericht</th><th>Actie</th></tr>';
            reqs.forEach(function (r) {
              var who = r.profiles || {};
              h += '<tr data-req="' + esc(r.id) + '"><td>' + day(r.created_at) + '</td><td><b>' + esc(who.full_name || '—') + '</b><br>' + esc(who.email || '') + '</td>' +
                '<td>' + (r.kind === 'visit' ? 'De kavel bezoeken' : 'Een gesprek') + '</td><td>' + esc(r.phone || '—') + '</td><td><div class="m">' + esc(r.note || '') + '</div></td>' +
                '<td><button class="go" data-act="handled">Afgehandeld</button></td></tr>';
            });
            h += '</table></div><div class="adm-section"></div>';
          }
          h += '<h2 class="display">Inschrijvingen</h2><p class="body">' + rows.length + ' inschrijvingen · <b>' + pend + '</b> investeerder(s) wachten op goedkeuring. ' +
            'Na goedkeuren kun je met "Stuur link" een inlogmail sturen. "Verwijderen" wist het account en alle gegevens van die persoon definitief. <a href="#acesso">Naar de besloten kant</a></p>' +
            '<div class="tblwrap"><table class="adm"><tr><th>Naam</th><th>Type</th><th>Investeerder</th><th>Taal</th><th>Ingeschreven</th><th>Bevestigd</th><th>Bericht</th><th>Actie</th></tr>';
          rows.forEach(function (r) {
            h += '<tr data-id="' + esc(r.id) + '" data-email="' + esc(r.email) + '"><td><b>' + esc(r.full_name || '—') + '</b><br>' + esc(r.email) + (r.blocked ? '<br><span class="pill pending">geblokkeerd</span>' : '') + '</td>' +
              '<td>' + (r.role === 'investor' ? 'Investeerder' : 'Koper') + '</td>' +
              '<td><span class="pill ' + esc(r.investor_status) + '">' + ({ none: '—', pending: 'wacht', approved: 'toegelaten', declined: 'afgewezen' }[r.investor_status] || '') + '</span></td>' +
              '<td>' + esc((r.lang || '').toUpperCase()) + '</td><td>' + day(r.created_at) + '</td><td>' + day(r.confirmed_at) + '</td>' +
              '<td><div class="m">' + esc(r.message || '') + '</div></td><td>' +
              (r.investor_status !== 'approved' && r.role === 'investor' ? '<button class="go" data-act="approved">Goedkeuren</button>' : '') +
              (r.investor_status === 'pending' || r.investor_status === 'approved' ? '<button data-act="declined">' + (r.investor_status === 'approved' ? 'Intrekken' : 'Afwijzen') + '</button>' : '') +
              '<button data-act="link">Stuur link</button><button data-act="' + (r.blocked ? 'unblock' : 'block') + '">' + (r.blocked ? 'Deblokkeren' : 'Blokkeren') + '</button>' +
              (r.id !== p.id && !r.is_admin ? '<button class="del" data-act="delete">Verwijderen</button>' : '') + '</td></tr>';
          });
          h += '</table></div><div class="adm-section"></div><h2 class="display">Bezoek</h2>' + statsHtml(stats);
          box.innerHTML = h;
          $$('button[data-act]', box).forEach(function (b) {
            b.addEventListener('click', function () {
              var tr = b.closest('tr'), id = tr.getAttribute('data-id'), act = b.getAttribute('data-act');
              if (act === 'delete' && !b.getAttribute('data-armed')) {          /* first click arms the button, second click deletes */
                b.setAttribute('data-armed', '1'); b.classList.add('danger'); b.textContent = 'Zeker weten? Definitief verwijderen';
                setTimeout(function () { if (b.isConnected && !b.disabled) { b.removeAttribute('data-armed'); b.classList.remove('danger'); b.textContent = 'Verwijderen'; } }, 6000);
                return;
              }
              b.disabled = true;
              var pr = act === 'handled' ? api.handleRequest(tr.getAttribute('data-req')) : act === 'delete' ? api.remove(id) : act === 'link' ? api.login(tr.getAttribute('data-email')) :
                act === 'block' ? api.setBlocked(id, true) : act === 'unblock' ? api.setBlocked(id, false) : api.setInvestor(id, act);
              pr.then(function (r) {
                if (r && r.error) { b.disabled = false; b.textContent = 'Mislukt'; return; }
                if (act === 'link') { b.textContent = 'Verstuurd'; return; }
                renderAdmin();
              }, function () { b.disabled = false; b.textContent = 'Mislukt'; });
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
      if (state.view === 'acesso' && !state.go) renderAccess();
      if (state.go) showGo(state.go);
    });
  });
  window.addEventListener('scroll', function () { $('#nav').classList.toggle('scrolled', window.scrollY > 10); }, { passive: true });
  window.addEventListener('hashchange', function () { state.go = null; route(); });
  applyLang(); initSignup();
  if (api && api.onAuth) api.onAuth(function (ev) { if (ev === 'SIGNED_OUT' && state.view !== 'home') route(); });

  /* The button in our e-mails opens this site with the one-time link attached (…/?go=<link>). The visitor clicks once
     more here; that keeps mail scanners, which open every link in a message, from using the link up first. */
  function showGo(url) {
    $('#view-home').hidden = true; $('#view-acesso').hidden = false; state.view = 'acesso'; state.go = url;
    $('#acesso').innerHTML = '<div class="gobox"><h2 class="display">' + t('go.h') + '</h2><p class="body">' + t('go.p') + '</p>' +
      '<a class="btn" rel="nofollow" href="' + esc(url) + '">' + t('go.btn') + '</a></div>';
  }
  var search = location.search, at = search.indexOf('go='), goUrl = at >= 0 ? search.slice(at + 3) : '';
  if (/^https?%3A/i.test(goUrl)) { try { goUrl = decodeURIComponent(goUrl); } catch (e) { goUrl = ''; } }
  var fromMail = /[?&]v=(acesso|admin)/.exec(search);

  if (goUrl && CFG.supabaseUrl && goUrl.indexOf(CFG.supabaseUrl + '/auth/v1/verify?') === 0) {
    showGo(goUrl);                                              /* only links to our own sign-in service are accepted */
  } else if (fromMail && api && at < 0) {
    /* arriving with a fresh session: let it settle, then tidy the address bar */
    $('#view-home').hidden = true; $('#view-acesso').hidden = false; state.view = 'acesso';
    $('#acesso').innerHTML = '<p class="note">' + t('acc.loading') + '</p>';
    var go = function () { history.replaceState(null, '', location.pathname + '#' + fromMail[1]); route(); };
    api.session().then(go, go);
  } else {
    route();
    if (state.view === 'home') track('view');
  }
})();
