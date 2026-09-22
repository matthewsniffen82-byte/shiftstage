"use client";


export function DashboardStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .dashboard-shell { --mydancr-dashboard-gap: 18px; --mydancr-dashboard-panel: #0b0b10; --mydancr-dashboard-panel-raised: #111118; --mydancr-dashboard-border: rgba(255,255,255,.11); --mydancr-dashboard-radius: 16px; --mydancr-dashboard-muted: rgba(218,214,230,.72); min-height: 100vh; padding: max(18px, calc(env(safe-area-inset-top) + 12px)) clamp(12px, 4vw, 56px) 56px; scroll-padding-top: max(18px, calc(env(safe-area-inset-top) + 12px)); background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.1), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.14), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      .dashboard-head, .dashboard-grid { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .dashboard-close { flex: 0 0 42px; width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #f8f7fb; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 10px 24px rgba(0,0,0,.3); text-decoration: none; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
      .dashboard-close svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; }
      .dashboard-close:hover { border-color: rgba(126,234,255,.42); background: rgba(38,34,48,.92); }
      .dashboard-close:active { transform: scale(.96); }
      .dashboard-close:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .dashboard-shell-customer { --mydancr-customer-accent: #a970ff; --mydancr-customer-accent-soft: rgba(139,92,246,.12); --mydancr-customer-accent-border: rgba(167,139,250,.3); }
      .customer-dashboard-nav a:focus-visible { outline: 2px solid var(--mydancr-customer-accent); outline-offset: 3px; }
      .dashboard-shell-customer .dashboard-head-row { grid-template-columns: minmax(0, 1fr) 36px; }
      .dashboard-shell-customer .dashboard-close { width: 36px !important; min-width: 36px !important; max-width: 36px !important; height: 36px !important; min-height: 36px !important; max-height: 36px !important; flex: 0 0 36px; padding: 0; border: 1px solid rgba(226,232,240,.22) !important; border-radius: 50% !important; color: rgba(255,255,255,.92) !important; background: linear-gradient(145deg,rgba(49,47,59,.96),rgba(19,19,25,.94)) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.08),0 8px 18px rgba(0,0,0,.36) !important; -webkit-backdrop-filter: blur(12px) saturate(1.2); backdrop-filter: blur(12px) saturate(1.2); line-height: 0; }
      .dashboard-shell-customer .dashboard-close svg { width: 15px !important; height: 15px !important; stroke-width: 1.85; }
      .dashboard-shell-customer .dashboard-close:hover { border-color: rgba(226,232,240,.34) !important; background: linear-gradient(145deg,rgba(58,56,68,.96),rgba(23,23,30,.94)) !important; }
      .dashboard-shell-customer .dashboard-close:focus-visible { border-color: rgba(226,232,240,.34) !important; outline: 2px solid rgba(255,255,255,.72); outline-offset: 2px; }
      .primary-link { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      button.primary-link { width: fit-content; cursor: pointer; font: inherit; }
      button.primary-link:disabled { cursor: wait; opacity: .68; }
      .venue-sign-in-recovery { width: min(100%, 460px); display: grid; gap: 12px; padding: 18px; border: 1px solid rgba(139,92,246,.42); border-radius: 18px; background: rgba(5,5,10,.96); box-shadow: 0 18px 54px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.06); }
      .venue-sign-in-recovery > p { font-size: 15px; line-height: 1.45; }
      .venue-sign-in-recovery label { display: grid; gap: 7px; color: #f7f2ff; font-size: 13px; font-weight: 850; }
      .venue-sign-in-recovery input { min-height: 48px; box-sizing: border-box; padding: 0 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; color: #fff; background: #15141b; font: inherit; }
      .venue-sign-in-recovery input:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .venue-sign-in-recovery .primary-link { width: 100%; min-height: 48px; border-color: rgba(139,92,246,.7); background: linear-gradient(135deg, #5b21b6, #3b00b9); }
      .venue-sign-in-recovery .venue-sign-in-status { color: #bfefff; font-size: 14px; font-weight: 750; }
      .dashboard-head { min-height: 72px; box-sizing: border-box; display: grid; gap: 12px; margin-bottom: var(--mydancr-dashboard-gap); padding: 10px 12px 14px; border: 1px solid rgba(139,92,246,.16); border-radius: var(--mydancr-dashboard-radius); background: rgba(5,5,8,.98); box-shadow: 0 14px 34px rgba(0,0,0,.38); }
      .dashboard-head-row { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: center; gap: 12px; }
      .dashboard-head-copy { min-width: 0; display: grid; gap: 5px; align-content: center; overflow: hidden; }
      .dashboard-head-title-row { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .dashboard-head h1 { max-width: 100%; overflow: hidden; color: #f8f7fb; font-family: var(--font-display, "Space Grotesk", "Outfit", sans-serif); font-size: clamp(21px, 5vw, 26px); font-weight: 850; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
      .dashboard-live-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid rgba(99,255,190,.28); border-radius: 999px; color: #8dffd0; background: rgba(32,185,121,.1); font-size: 10px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .dashboard-live-status i { width: 7px; height: 7px; border-radius: 50%; background: #65ffb9; box-shadow: 0 0 10px rgba(101,255,185,.5); }
      .dashboard-head p { font-size: clamp(15px, 2.2vw, 17px); line-height: 1.45; }
      .dashboard-head .eyebrow { color: #f8f7fb; }
      .dashboard-shell-venue .dashboard-head { min-height: 0; gap: 18px; padding: 24px 26px; border-radius: 24px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-shell-venue .dashboard-head-row { align-items: start; gap: 18px; }
      .dashboard-shell-venue .dashboard-head-copy { gap: 8px; overflow: visible; }
      .dashboard-shell-venue .dashboard-head h1 { overflow: visible; font-size: clamp(32px,5vw,48px); line-height: 1; text-overflow: clip; white-space: normal; }
      .dashboard-shell-venue .dashboard-head p { color: var(--mydancr-dashboard-muted); font-size: clamp(15px,2.2vw,17px); }
      .dashboard-shell-venue .dashboard-head .eyebrow { color: #94e5ff; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(32px, 5vw, 48px); line-height: 1; letter-spacing: -.025em; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--mydancr-dashboard-gap); }
      .agent-dashboard-shortcut { grid-column: 1 / -1; min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 18px; border: 1px solid rgba(126,234,255,.24); border-radius: var(--mydancr-dashboard-radius); color: #fff; background: linear-gradient(115deg, rgba(18,105,125,.18), rgba(48,22,91,.18)); text-decoration: none; }
      .agent-dashboard-shortcut span { display: grid; gap: 4px; }
      .agent-dashboard-shortcut small { color: #7eeaff; font-size: 11px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
      .agent-dashboard-shortcut strong { font-size: 18px; }
      .agent-dashboard-shortcut b { color: #d9d2e9; font-size: 13px; white-space: nowrap; }
      .agent-dashboard-shortcut:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .customer-welcome-card { position: relative; grid-column: 1 / -1; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: start; gap: 14px; padding: 18px; border: 1px solid rgba(167,139,250,.3); border-radius: 16px; background: linear-gradient(135deg, rgba(76,29,149,.2), rgba(255,255,255,.035)); box-shadow: inset 3px 0 0 rgba(139,92,246,.72); }
      .customer-welcome-lock { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; color: #ddd6fe; background: rgba(255,255,255,.055); }
      .customer-welcome-lock svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .customer-welcome-copy { min-width: 0; display: grid; gap: 8px; }
      .customer-welcome-copy h2, .customer-welcome-copy p { margin: 0; }
      .customer-welcome-copy h2 { color: #fff; font-size: clamp(21px, 4vw, 28px); }
      .customer-welcome-copy p { max-width: 680px; color: #c8c1d2; font-size: 14px; line-height: 1.5; }
      .customer-welcome-copy ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 18px; margin: 4px 0; padding: 0; list-style: none; }
      .customer-welcome-copy li { position: relative; padding-left: 18px; color: #eeeaf5; font-size: 13px; font-weight: 800; line-height: 1.4; }
      .customer-welcome-copy li::before { content: "✓"; position: absolute; left: 0; color: #a78bfa; font-weight: 950; }
      .customer-welcome-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; }
      .customer-welcome-actions a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid rgba(167,139,250,.48); border-radius: 10px; color: #fff; background: #6d28d9; font-size: 13px; font-weight: 900; text-decoration: none; }
      .customer-welcome-actions a + a { border-color: rgba(255,255,255,.13); background: rgba(255,255,255,.06); }
      .customer-welcome-card > button { width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.12); border-radius: 50%; color: #d7d1df; background: rgba(255,255,255,.045); font: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
      .customer-welcome-card a:focus-visible, .customer-welcome-card > button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 3px; }
      .venue-dashboard-grid { grid-template-columns: 1fr; }
      .dashboard-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .venue-dashboard-loading { display: grid; gap: var(--mydancr-dashboard-gap); }
      .venue-dashboard-loading-command, .venue-dashboard-loading-actions, .venue-dashboard-loading-metrics { border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .venue-dashboard-loading-command { min-height: 226px; display: grid; grid-template-columns: 112px minmax(0,1fr); align-items: start; gap: 18px; padding: 22px; }
      .venue-dashboard-loading-pill, .venue-dashboard-loading-copy span, .venue-dashboard-loading-actions span, .venue-dashboard-loading-metrics span { display: block; background: linear-gradient(100deg, rgba(255,255,255,.055) 20%, rgba(139,92,246,.13) 45%, rgba(255,255,255,.055) 70%); background-size: 240% 100%; animation: venueDashboardLoadingPulse 1.25s ease-in-out infinite; }
      .venue-dashboard-loading-pill { width: 86px; height: 42px; border-radius: 999px; }
      .venue-dashboard-loading-copy { display: grid; gap: 13px; padding-top: 3px; }
      .venue-dashboard-loading-copy span { height: 18px; border-radius: 7px; }
      .venue-dashboard-loading-copy span:first-child { width: min(78%, 330px); height: 28px; }
      .venue-dashboard-loading-copy span:last-child { width: min(62%, 260px); }
      .venue-dashboard-loading-actions { min-height: 86px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; padding: 12px; }
      .venue-dashboard-loading-actions span { border-radius: 12px; }
      .venue-dashboard-loading-metrics { min-height: 74px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1px; overflow: hidden; }
      .venue-dashboard-loading-metrics span { border-radius: 0; }
      @keyframes venueDashboardLoadingPulse { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
      @media (prefers-reduced-motion: reduce) { .venue-dashboard-loading-pill, .venue-dashboard-loading-copy span, .venue-dashboard-loading-actions span, .venue-dashboard-loading-metrics span { animation: none; } }
      .venue-command-panel, .venue-publication-panel, .venue-workspace-tabs, .venue-workspace-summary, .venue-workspace-business-summary, .venue-dashboard-metrics { grid-column: 1 / -1; }
      .venue-command-panel { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 18px; background: var(--mydancr-dashboard-panel); }
      .venue-command-status { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 0 2px; }
      .venue-command-status h2 { color: #f8f7fb; font-size: 20px; letter-spacing: -.015em; line-height: 1.15; }
      .venue-command-status p, .venue-command-primary p { color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 760; line-height: 1.35; }
      .venue-live-pill { display: grid; place-items: center; padding: 7px 10px; border: 1px solid rgba(38,210,159,.65); border-radius: 999px; color: #76f0c8; background: rgba(10,74,57,.36); font-size: 11px; font-weight: 950; letter-spacing: .08em; }
      .venue-live-pill.is-draft { border-color: rgba(196,181,253,.38); color: #ddd6fe; background: rgba(109,40,217,.14); }
      .venue-live-pill.is-inactive { border-color: var(--mydancr-dashboard-border); color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.035); }
      .venue-refresh-control { display: grid; justify-items: end; gap: 5px; }
      .venue-refresh-control small, .venue-refresh-status { color: var(--mydancr-dashboard-muted); font-size: 10px; font-weight: 760; }
      .venue-refresh-control button { min-height: 34px; padding: 0 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; color: #f8fafc; background: rgba(255,255,255,.045); font: inherit; font-size: 11px; font-weight: 850; cursor: pointer; }
      .venue-refresh-control button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-refresh-control button:disabled { opacity: .6; cursor: wait; }
      .venue-command-primary { display: grid; gap: 8px; padding: 16px; border: 1px solid rgba(255,255,255,.13); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel-raised); }
      .venue-command-primary > strong { color: #f8f7fb; font-size: clamp(21px, 4vw, 27px); line-height: 1.08; }
      .venue-command-links { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin-top: 5px; }
      .venue-command-primary .venue-current-deals-link, .venue-command-primary .venue-working-now-link { width: 100%; max-width: 100%; min-height: 52px; box-sizing: border-box; border-radius: 14px; }
      .venue-command-primary .venue-current-deals-link { border: 1px solid rgba(196,181,253,.58); color: #f8fafc; background: #7c3aed; box-shadow: 0 0 18px rgba(124,58,237,.2); }
      .venue-command-primary .venue-working-now-link { border: 1px solid var(--mydancr-dashboard-border); color: #f8fafc; background: #111118; box-shadow: none; }
      .venue-command-primary .venue-working-now-link.is-live { border-color: rgba(16,185,129,.58); color: #d1fae5; background: rgba(6,78,59,.34); box-shadow: 0 0 18px rgba(16,185,129,.12); }
      .venue-publication-panel { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(139,92,246,.32); border-radius: var(--mydancr-dashboard-radius); background: linear-gradient(145deg, rgba(31,19,53,.72), rgba(11,11,16,.98) 64%); box-shadow: inset 3px 0 0 rgba(139,92,246,.72); }
      .venue-publication-panel.is-published { border-color: rgba(16,185,129,.34); background: linear-gradient(145deg, rgba(6,78,59,.18), rgba(11,11,16,.98) 64%); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-publication-panel > div:first-child { display: grid; gap: 7px; }
      .venue-publication-panel h2 { margin: 0; color: #f8fafc; font-size: clamp(20px,3.5vw,27px); line-height: 1.08; }
      .venue-publication-panel p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.48; }
      .venue-publication-actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .venue-publication-actions > button, .venue-publication-actions > a { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 10px; color: #f8fafc; background: #17171d; font: inherit; font-size: 13px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .venue-publication-actions > .primary { border-color: rgba(196,181,253,.6); background: #7c3aed; box-shadow: 0 0 18px rgba(124,58,237,.2); }
      .venue-publication-actions > .venue-preview-action { gap: 9px; border-color: rgba(139,92,246,.7); background: linear-gradient(145deg,rgba(58,28,116,.82),rgba(20,11,40,.92)); box-shadow: 0 0 0 1px rgba(124,58,237,.15),0 0 22px rgba(124,58,237,.24),inset 0 1px 0 rgba(255,255,255,.08); }
      .venue-publication-actions > .venue-preview-action > svg { width: 18px; height: 18px; fill: none; stroke: #d8ccff; stroke-width: 1.8; filter: drop-shadow(0 0 7px rgba(167,139,250,.95)); }
      .venue-publication-actions > .venue-preview-action:hover { border-color: rgba(196,181,253,.92); background: linear-gradient(145deg,rgba(76,35,154,.9),rgba(28,14,56,.96)); box-shadow: 0 0 0 1px rgba(167,139,250,.2),0 0 28px rgba(124,58,237,.34),inset 0 1px 0 rgba(255,255,255,.1); }
      .venue-publication-actions > button:focus-visible, .venue-publication-actions > a:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
      .venue-publication-actions > button:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
      .venue-publication-panel > p[role="status"] { padding: 10px 12px; border: 1px solid rgba(148,229,255,.24); border-radius: 9px; color: #baf5ff; background: rgba(148,229,255,.07); font-weight: 850; }
      .venue-review-request { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(251,191,36,.25); border-radius: 10px; background: rgba(251,191,36,.045); }
      .venue-review-completion { display: grid; gap: 9px; padding: 14px; border: 1px solid rgba(139,92,246,.44); border-radius: 13px; background: linear-gradient(145deg,rgba(46,22,89,.36),rgba(8,8,12,.9)); box-shadow: inset 0 1px 0 rgba(255,255,255,.045); }
      .venue-review-completion h3 { margin: 0; color: #f8fafc; font-size: 19px; line-height: 1.15; }
      .venue-review-completion > p { color: #aaa3b4; font-size: 12px; line-height: 1.45; }
      .venue-review-completion .venue-publication-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin-top: 3px; }
      .venue-review-completion .venue-publication-actions > * { width: 100%; min-height: 52px; padding-inline: 18px; border-radius: 14px; line-height: 1.2; white-space: nowrap; }
      .venue-review-completion .venue-publication-actions > .venue-preview-action { border-color: rgba(167,139,250,.45) !important; background: rgba(8,8,13,.9) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.045) !important; }
      .venue-review-completion .venue-publication-actions > .venue-preview-action:hover { border-color: rgba(196,181,253,.72) !important; background: rgba(20,13,35,.94) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.06) !important; }
      .venue-review-completion .venue-publication-actions > .primary { border-color: rgba(196,181,253,.72) !important; color: #fff !important; background: linear-gradient(135deg,#6d28d9,#7c3aed) !important; box-shadow: 0 8px 22px rgba(76,29,149,.28), inset 0 1px 0 rgba(255,255,255,.14) !important; }
      .venue-review-package { display: grid; gap: 14px; padding: 14px; border: 1px solid rgba(255,255,255,.13); border-radius: 13px; background: rgba(8,8,12,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.035); }
      .venue-review-package-heading { min-width: 0; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 13px; }
      .venue-review-package-heading > span:last-child { min-width: 0; display: grid; gap: 5px; }
      .venue-review-package-heading > span:last-child > strong { color: #f8fafc; font-size: clamp(19px,3vw,23px); line-height: 1.08; }
      .venue-review-package-heading > span:last-child > small { color: #a19aa9; font-size: 11px; line-height: 1.4; }
      .venue-review-logo { width: 72px; height: 72px; display: grid; place-items: center; overflow: hidden; box-sizing: border-box; padding: 8px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; color: #f3eaff; background: #17171d; box-shadow: inset 0 1px 0 rgba(255,255,255,.045); font-size: 18px; font-weight: 950; letter-spacing: .06em; }
      .venue-review-logo img { width: 100%; height: 100%; display: block; object-fit: contain; }
      .venue-review-logo img.is-compact-logo-source { transform: scale(1.7); transform-origin: center; }
      .venue-review-package-section { min-width: 0; display: grid; gap: 9px; padding-top: 13px; border-top: 1px solid rgba(255,255,255,.09); }
      .venue-review-package-section > strong { color: #f8fafc; font-size: 15px; line-height: 1.2; }
      .venue-review-commercial-heading { min-width: 0; display: grid; gap: 5px; }
      .venue-review-commercial-heading strong { color: #f8fafc; font-size: 17px; line-height: 1.15; }
      .venue-review-commercial-heading small { color: #9ca3af; font-size: 11px; line-height: 1.4; }
      .venue-review-package dl { min-width: 0; display: grid; gap: 8px; margin: 0; }
      .venue-review-package dl > div { min-width: 0; display: grid; grid-template-columns: minmax(108px,.42fr) minmax(0,1fr); gap: 11px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.08); border-radius: 9px; background: rgba(255,255,255,.025); }
      .venue-review-package dt { color: #8f879a; font-size: 10px; font-weight: 900; letter-spacing: .05em; text-transform: uppercase; }
      .venue-review-package dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #f8fafc; font-size: 12px; font-weight: 800; line-height: 1.35; }
      .venue-review-request label { color: #f8fafc; font-size: 12px; font-weight: 900; }
      .venue-review-request textarea { width: 100%; min-height: 88px; box-sizing: border-box; resize: vertical; padding: 10px 11px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #f8fafc; background: #111118; font: inherit; }
      .venue-review-request textarea:focus { border-color: #7c3aed; outline: 2px solid rgba(124,58,237,.22); outline-offset: 1px; }
      .venue-review-request button { width: fit-content; min-height: 42px; padding: 0 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 9px; color: #f8fafc; background: #17171d; font: inherit; font-weight: 900; }
      .venue-review-request button:disabled { opacity: .45; cursor: not-allowed; }
      .venue-workspace-tabs { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; padding: 5px; border: 1px solid rgba(255,255,255,.12); border-radius: 16px; background: rgba(7,7,11,.94); box-shadow: 0 16px 38px rgba(0,0,0,.42); backdrop-filter: blur(18px); }
      .venue-workspace-tabs button { min-width: 0; min-height: 78px; display: grid; align-content: center; gap: 4px; padding: 8px 9px; border: 0; border-radius: 11px; color: #a9a3b3; background: transparent; font: inherit; text-align: center; cursor: pointer; }
      .venue-workspace-tabs button:hover { color: #fff; background: rgba(255,255,255,.045); }
      .venue-workspace-tabs button:focus-visible { outline: 2px solid #a78bfa; outline-offset: -2px; }
      .venue-workspace-tabs button.active { color: #fff; background: linear-gradient(135deg,rgba(124,58,237,.9),rgba(88,28,135,.92)); box-shadow: 0 8px 20px rgba(76,29,149,.28), inset 0 1px 0 rgba(255,255,255,.14); }
      .venue-workspace-tabs strong { overflow: hidden; font-size: 14px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
      .venue-workspace-tabs small { display: grid; min-height: 21px; place-items: center; color: #cbd5e1; font-size: 9px; font-weight: 820; line-height: 1.18; }
      .venue-workspace-tabs button.active small { color: #f8fafc; }
      .venue-workspace-tab-status { min-width: 0; color: #94a3b8; font-size: 8px; font-weight: 780; line-height: 1.12; white-space: normal; overflow-wrap: anywhere; }
      .venue-workspace-tab-status > span { display: block; }
      .venue-workspace-tabs button.active .venue-workspace-tab-status { color: #ddd6fe; }
      .venue-workspace-business-summary { display: grid; gap: 7px; padding: 16px 18px; border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .venue-workspace-business-summary h2 { margin: 0; color: #f8fafc; font-size: clamp(20px,3.5vw,25px); line-height: 1.08; }
      .venue-workspace-business-summary p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.45; }
      .venue-workspace-summary[hidden], .venue-publication-panel[hidden], .venue-workspace-business-summary[hidden], .venue-dashboard-metrics[hidden], .venue-dashboard-section[hidden] { display: none !important; }
      .venue-dashboard-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel); }
      .venue-dashboard-metrics .metric { min-width: 0; min-height: 66px; padding: 12px 14px; border-left: 1px solid var(--mydancr-dashboard-border); background: transparent; }
      .venue-dashboard-metrics .metric:first-child { border-left: 0; }
      .venue-dashboard-metrics .metric strong { font-size: 22px; }
      .venue-dashboard-metrics .metric span { font-size: 10px; }
      .venue-tonight-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .venue-dashboard-section { grid-column: 1 / -1; overflow: clip; scroll-margin-top: calc(var(--mydancr-preview-banner-offset, 0px) + 12px); border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); box-shadow: none; }
      .venue-dashboard-section > summary { min-height: 76px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 16px 18px; color: #f8fafc; cursor: pointer; list-style: none; }
      .venue-dashboard-section > summary::-webkit-details-marker { display: none; }
      .venue-dashboard-section > summary:focus-visible { outline: 2px solid #7c3aed; outline-offset: -4px; }
      .venue-dashboard-section > summary:hover { background: rgba(255,255,255,.025); }
      .venue-dashboard-section[open] > summary { border-bottom: 1px solid var(--mydancr-dashboard-border); background: rgba(139,92,246,.035); }
      .venue-dashboard-section-copy { min-width: 0; display: grid; gap: 5px; }
      .venue-dashboard-section-copy > strong { color: #f8fafc; font-size: clamp(17px, 2.8vw, 21px); line-height: 1.05; }
      .venue-dashboard-section-copy > span:last-child { max-width: 72ch; color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 720; line-height: 1.35; }
      .venue-dashboard-section-badge { width: fit-content; padding: 7px 10px; border: 1px solid rgba(139,92,246,.34); border-radius: 999px; color: #e6ddf7; background: rgba(109,40,217,.13); font-size: 11px; font-weight: 900; white-space: nowrap; }
      .venue-dashboard-section-toggle { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(124,58,237,.44); border-radius: 50%; color: #f8fafc; background: rgba(124,58,237,.15); font-size: 20px; line-height: 1; transition: transform .18s ease, background .18s ease; }
      .venue-dashboard-section[open] .venue-dashboard-section-toggle { transform: rotate(45deg); background: rgba(124,58,237,.28); }
      .venue-dashboard-section-toggle.is-chevron svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .venue-dashboard-section[open] .venue-dashboard-section-toggle.is-chevron { transform: rotate(180deg); background: rgba(124,58,237,.2); }
      .venue-dashboard-section-body { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-summary { border-color: rgba(76,223,166,.2); background: linear-gradient(145deg,rgba(8,25,20,.58),#09090d 70%); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-primary { border-color: rgba(139,92,246,.3); background: linear-gradient(145deg,rgba(25,16,41,.82),#09090d 72%); box-shadow: inset 3px 0 0 rgba(139,92,246,.62); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-secondary { border-color: rgba(148,229,255,.17); background: linear-gradient(145deg,rgba(10,21,27,.48),#09090d 72%); }
      .dashboard-shell.dashboard-shell-dancer .venue-dashboard-section.dashboard-section-utility { border-color: rgba(255,255,255,.075); background: #07070a; }
      .dashboard-shell-dancer .dashboard-section-summary > summary { min-height: 68px; }
      .dashboard-shell-dancer .dashboard-section-primary > summary { min-height: 80px; }
      .dashboard-shell-dancer .dashboard-section-secondary > summary { min-height: 72px; }
      .dashboard-shell-dancer .dashboard-section-utility > summary { min-height: 64px; }
      .dashboard-shell-dancer .dashboard-section-primary .venue-dashboard-section-copy > strong { font-size: clamp(20px,3vw,23px); }
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-copy > strong { color: #e4e2e8; font-size: clamp(16px,2.5vw,18px); }
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-copy > span:last-child { color: rgba(218,218,226,.72); font-size: 12px; }
      .dashboard-shell-dancer .dashboard-section-summary .venue-dashboard-section-toggle,
      .dashboard-shell-dancer .dashboard-section-utility .venue-dashboard-section-toggle { width: 28px; height: 28px; }
      .venue-dashboard-inner-grid { display: grid; gap: var(--mydancr-dashboard-gap); }
      .venue-dashboard-overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .venue-dashboard-account-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .venue-dashboard-section-body > .info-panel, .venue-dashboard-inner-grid > .info-panel { grid-column: auto; border-color: transparent; background: var(--mydancr-dashboard-panel-raised); box-shadow: none; }
      .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-dashboard-nav { grid-column: 1 / -1; display: grid; gap: 7px; padding: 7px; border: 1px solid var(--mydancr-customer-accent-border); border-radius: 18px; background: radial-gradient(circle at 50% 0, rgba(139,92,246,.1), transparent 72%), rgba(7,7,11,.9); box-shadow: 0 16px 38px rgba(0,0,0,.28), 0 0 22px rgba(124,58,237,.08); backdrop-filter: blur(16px); }
      .customer-dashboard-primary-links { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
      .customer-dashboard-primary-links a { min-width: 0; min-height: 68px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 11px 12px; border: 1px solid rgba(167,139,250,.2); border-radius: 13px; color: #f8f7fb; background: rgba(255,255,255,.035); font-size: 13px; font-weight: 900; text-decoration: none; }
      .customer-dashboard-primary-links a:hover { border-color: rgba(167,139,250,.48); background: rgba(139,92,246,.12); }
      .customer-dashboard-primary-links a > span { min-width: 0; line-height: 1.2; }
      .customer-dashboard-primary-links a > strong { min-width: 28px; height: 24px; display: grid; place-items: center; padding: 0 7px; border: 1px solid rgba(196,181,253,.65); border-radius: 999px; color: #fff; background: #6d28d9; box-shadow: 0 0 14px rgba(139,92,246,.22); font-size: 11px; }
      .customer-dashboard-utility-links { display: flex; justify-content: flex-end; gap: 6px; padding-top: 1px; }
      .customer-dashboard-utility-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #cfc5de; font-size: 12px; font-weight: 900; text-decoration: none; }
      .customer-dashboard-utility-links a:hover { color: #fff; background: rgba(255,255,255,.06); }
      /* Keep customer shortcuts readable above the shared dashboard surface overrides. */
      body.dancr-button-system .dashboard-shell-customer .customer-dashboard-nav { border-color: rgba(167,139,250,.38) !important; background: #100e17 !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-dashboard-nav a { color: #f8f7fb !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-dashboard-primary-links a { border-color: rgba(167,139,250,.36); background: #191620 !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-dashboard-utility-links a { border: 1px solid rgba(167,139,250,.22); background: #191620 !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-dashboard-nav a:is(:hover, :focus-visible) { border-color: rgba(196,181,253,.7); background: #2b203d !important; }
      .customer-action-status { grid-column: 1 / -1; max-width: none; padding: 11px 14px; border: 1px solid var(--mydancr-customer-accent-border); border-radius: 10px; color: #ddd1ff; background: var(--mydancr-customer-accent-soft); font-size: 14px; }
      .info-panel { border: 1px solid var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel); border-radius: var(--mydancr-dashboard-radius); padding: 16px; display: grid; gap: 14px; box-shadow: none; }
      .info-panel h2 { font-size: clamp(20px, 3vw, 24px); line-height: 1.08; }
      .info-panel > p { color: var(--mydancr-dashboard-muted); font-size: 14px; line-height: 1.45; }
      .info-panel > div { display: grid; gap: 10px; }
      .setup-panel { grid-column: span 3; }
      .setup-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .setup-panel label, .upload-panel label, .verification-panel label, .shift-panel label, .customer-settings-panel label, .socials-panel label, .share-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .setup-panel label:nth-of-type(4) { grid-column: span 3; }
      .setup-panel input, .setup-panel textarea, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input[type="text"], .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .setup-panel input, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { min-height: 42px; }
      .setup-panel .dancer-stage-name-input { box-sizing: border-box; height: 56px; min-height: 56px; max-height: 56px; padding-block: 0; }
      .setup-panel textarea { resize: vertical; min-height: 108px; }
      .setup-panel button, .upload-panel button, .verification-panel button, .shift-panel button, .customer-settings-panel button, .socials-panel button, .share-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; }
      .setup-panel button:disabled, .upload-panel button:disabled, .verification-panel button:disabled, .shift-panel button:disabled, .customer-settings-panel button:disabled, .socials-panel button:disabled { opacity: .62; cursor: wait; }
      .setup-panel p, .upload-panel p, .verification-panel p, .shift-panel p, .customer-settings-panel p, .socials-panel p, .share-panel p { color: #94e5ff; font-size: 14px; }
      .visibility-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6d28d9, #22c7ff); font: inherit; font-weight: 950; cursor: pointer; }
      .visibility-panel button:disabled { opacity: .62; cursor: wait; }
      .visibility-panel.is-incognito { border-color: rgba(148,229,255,.34); box-shadow: inset 0 0 0 1px rgba(148,229,255,.08); }
      .visibility-copy { display: grid; gap: 8px; }
      .visibility-state { width: fit-content; min-height: 34px; display: inline-flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #fff; background: rgba(255,255,255,.045); }
      .visibility-state strong { font-size: 13px; }
      .visibility-state span { color: rgba(255,255,255,.38); }
      .visibility-state b { color: #70efbd; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .visibility-panel.is-incognito .visibility-state b { color: #b7effa; }
      .visibility-copy p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.45; }
      .visibility-panel button.visibility-toggle { width: fit-content; min-height: 44px; padding: 0 13px; border-radius: 999px; font-size: 11px; }
      .visibility-status { margin: 0; }
      .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .visibility-panel, .venue-working-panel, .venue-verification-panel { grid-column: span 3; }
      .dancer-performance-workspace { display: grid; gap: 14px; }
      .dancer-nats-signup-callout { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 16px; padding: 17px 18px; border: 1px solid rgba(148,229,255,.26); border-radius: var(--mydancr-dashboard-radius); background: linear-gradient(145deg,rgba(12,33,42,.68),#09090d 72%); box-shadow: inset 3px 0 0 rgba(148,229,255,.58); }
      .dancer-nats-signup-copy { min-width: 0; display: grid; gap: 5px; }
      .dancer-nats-signup-copy .eyebrow { color: #94e5ff; }
      .dancer-nats-signup-copy > strong { color: #fff; font-size: clamp(18px,2.8vw,22px); line-height: 1.08; }
      .dancer-nats-signup-copy > small { max-width: 68ch; color: var(--mydancr-dashboard-muted); font-size: 12px; font-weight: 720; line-height: 1.4; }
      .dancer-nats-signup-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
      .dancer-nats-signup-actions > a, .dancer-nats-signup-actions > button, .dancer-nats-signup-actions > b { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; font: inherit; font-size: 13px; font-weight: 950; text-align: center; text-decoration: none; white-space: nowrap; }
      .dancer-nats-signup-actions > a { border-color: rgba(126,234,255,.48); color: #fff; background: linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow: 0 8px 22px rgba(61,27,143,.24); }
      .dancer-nats-signup-actions > a.secondary { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; box-shadow: none; }
      .dancer-nats-signup-actions > button { color: #f8f7fb; background: #17171d; cursor: pointer; }
      .dancer-nats-signup-actions > b { color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.035); }
      .dancer-nats-signup-actions > a:focus-visible, .dancer-nats-signup-actions > button:focus-visible { outline: 2px solid #94e5ff; outline-offset: 3px; }
      .dancer-performance-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .dancer-performance-summary .metric { min-height: 76px; padding: 13px 15px; border-top: 0; border-left: 1px solid var(--mydancr-dashboard-border); }
      .dancer-performance-summary .metric:first-child { border-left: 0; }
      .dancer-performance-details { display: grid; gap: 10px; }
      .dancer-performance-detail { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .dancer-performance-detail > summary { min-height: 78px; display: grid; grid-template-columns: minmax(0, 1fr) auto 38px; align-items: center; gap: 12px; padding: 14px 16px; list-style: none; cursor: pointer; }
      .dancer-performance-detail > summary::-webkit-details-marker, .dancer-performance-explainer > summary::-webkit-details-marker { display: none; }
      .dancer-performance-detail > summary > span { min-width: 0; display: grid; gap: 4px; }
      .dancer-performance-detail > summary strong { color: #fff; font-size: 18px; }
      .dancer-performance-detail > summary small { color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.35; }
      .dancer-performance-detail > summary > b { width: fit-content; padding: 6px 9px; border: 1px solid rgba(50,255,164,.22); border-radius: 999px; color: #78ffc0; background: rgba(50,255,164,.06); font-size: 11px; white-space: nowrap; }
      .dancer-performance-detail > summary > i { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid rgba(124,58,237,.48); border-radius: 50%; color: #fff; background: rgba(82,35,214,.2); font-size: 24px; font-style: normal; line-height: 1; transition: transform .18s ease; }
      .dancer-performance-detail[open] > summary > i { transform: rotate(45deg); }
      .dancer-performance-detail > summary:focus-visible, .dancer-performance-explainer > summary:focus-visible, .earnings-history-tabs button:focus-visible { outline: 2px solid #94e5ff; outline-offset: -3px; }
      .dancer-performance-detail-body { padding: 16px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .dancer-performance-detail-body > .info-panel { grid-column: auto; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .dancer-performance-progress { margin: 0; padding: 11px 13px; border: 1px solid rgba(50,255,164,.2); border-radius: 10px; color: #dfffee !important; background: rgba(50,255,164,.06); font-weight: 850; }
      .dancer-performance-explainer { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.025); }
      .dancer-performance-explainer > summary { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 13px; color: #f7f2ff; font-size: 13px; font-weight: 900; list-style: none; cursor: pointer; }
      .dancer-performance-explainer > summary::after { content: "+"; color: #94e5ff; font-size: 20px; line-height: 1; }
      .dancer-performance-explainer[open] > summary::after { content: "−"; }
      .dancer-performance-explainer > .deal-metrics, .dancer-performance-explainer > .commission-tier-table, .dancer-performance-explainer > .dancer-performance-explainer-copy { margin: 0 12px 12px; }
      .dancer-performance-explainer > p { margin: 0; padding: 0 13px 13px; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.5; }
      .dancer-performance-explainer-copy { display: grid; gap: 8px; }
      .dancer-performance-explainer-copy p { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.5; }
      .earnings-history { display: grid; gap: 12px; }
      .earnings-history-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; padding: 5px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.025); }
      .earnings-history-tabs button { min-height: 40px; border: 0; border-radius: 7px; color: var(--mydancr-dashboard-muted); background: transparent; font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
      .earnings-history-tabs button.active { color: #fff; background: rgba(82,35,214,.48); box-shadow: inset 0 0 0 1px rgba(124,58,237,.5); }
      .earnings-filters { display: flex !important; flex-wrap: wrap; gap: 6px !important; }
      .earnings-filters button { min-height: 34px; padding: 0 10px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 999px; color: var(--mydancr-dashboard-muted); background: rgba(255,255,255,.03); font: inherit; font-size: 11px; font-weight: 850; cursor: pointer; }
      .earnings-filters button.active { border-color: rgba(148,229,255,.38); color: #fff; background: rgba(148,229,255,.1); }
      .earnings-statement-button { width: fit-content; min-height: 40px; padding: 0 12px; }
      .weekly-result-summary { display: flex !important; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: rgba(255,255,255,.03); }
      .weekly-result-summary > span { display: grid; gap: 3px; }
      .weekly-result-summary strong { color: #fff; font-size: 17px; }
      .weekly-result-summary small, .weekly-result-summary b { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .impact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .event-list { display: grid; gap: 10px; }
      .event-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .event-row span { color: #b9accd; font-size: 13px; }
      .impact-panel p { color: #94e5ff; font-size: 14px; }
      .locked-analytics-panel { grid-column: span 2; align-content: start; }
      .locked-analytics-head { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; }
      .locked-analytics-head span { width: fit-content; padding: 5px 9px; border-radius: 999px; border: 1px solid rgba(148,229,255,.2); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .locked-analytics-panel p { color: #fff; font-size: 18px; font-weight: 900; }
      .locked-analytics-panel small { color: #b9accd; font-size: 14px; line-height: 1.55; }
      .locked-preview-list { display: grid; gap: 8px; margin-top: 2px; }
      .locked-preview-list span { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); color: rgba(247,242,255,.72); font-size: 13px; font-weight: 850; }
      .share-panel-head { display: flex !important; align-items: center; justify-content: space-between; gap: 14px; }
      .share-panel-head > div { display: grid; gap: 5px; }
      .share-grid { display: grid; gap: 10px; }
      .share-link-row { min-width: 0; padding: 12px 13px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: var(--mydancr-dashboard-panel-raised); }
      .share-link-row > span { min-width: 0; display: grid; gap: 4px; }
      .share-link-row small { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .share-link-row strong { overflow: hidden; color: #fff; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .share-grid img, .qr-placeholder { width: 180px; height: 180px; border-radius: 8px; background: #f7f2ff; }
      .qr-placeholder { display: grid; place-items: center; color: #050507; font-weight: 950; }
      .share-actions { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px !important; }
      .share-panel .share-actions button, .share-actions a { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 13px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 900; text-decoration: none; }
      .share-panel .share-actions button { border: 1px solid rgba(124,58,237,.5); color: #fff; background: rgba(82,35,214,.56); }
      .share-actions .share-open-profile-button { gap: 8px; border: 1px solid var(--dancr-color-border); color: var(--dancr-color-text-primary); background: var(--dancr-color-surface-raised); }
      .share-open-profile-button svg { width: 16px; height: 16px; flex: 0 0 auto; }
      .share-status { margin: 0; color: #78ffc0 !important; font-size: 12px !important; }
      .socials-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .upload-panel form, .verification-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: end; }
      .shift-panel form { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
      .shift-checkin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px; border-radius: 8px; border: 1px solid rgba(148,229,255,.18); background: rgba(148,229,255,.06); }
      .shift-checkin-card.ready { border-color: rgba(50,255,164,.42); background: rgba(50,255,164,.1); box-shadow: inset 3px 0 0 rgba(50,255,164,.78); }
      .shift-checkin-card span { display: grid; gap: 5px; }
      .shift-checkin-card strong { color: #fff; font-size: 18px; }
      .shift-checkin-card small { color: #cfc5de; line-height: 1.45; }
      .shift-checkin-card button { min-height: 44px; border: 0; border-radius: 8px; color: #050507; background: #94e5ff; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .shift-checkin-card button.check-in-retry { color: #fff; background: #7c3aed; box-shadow: 0 10px 24px rgba(82,35,214,.26), inset 0 1px 0 rgba(255,255,255,.12); }
      .shift-checkin-card button.check-in-retry::before { content: "↻"; margin-right: 7px; font-size: 16px; line-height: 1; }
      .shift-checkin-card button.check-in-confirmation, .shift-actions button.check-in-confirmation { border: 1px solid var(--dancr-color-success-medium); color: var(--dancr-color-success); background: var(--dancr-color-success-soft); box-shadow: inset 0 0 0 1px var(--dancr-color-success-soft) !important; cursor: default !important; filter: none !important; opacity: 1 !important; }
      .shift-checkin-card .shift-checkin-status { grid-column: 1 / -1; display: block; padding: 10px 12px; border: 1px solid rgba(148,229,255,.24); border-radius: 8px; color: #94e5ff; background: rgba(148,229,255,.08); font-weight: 850; }
      .shift-checkin-card .shift-checkin-status.is-error { border-color: var(--dancr-color-danger-medium); color: #fecaca; background: var(--dancr-color-danger-soft); }
      .shift-checkin-card .shift-checkin-status.is-success { border-color: var(--dancr-color-success-medium); color: #a7f3d0; background: var(--dancr-color-success-soft); }
      .shift-checkin-card button.shift-demo-managed:disabled { border: 1px solid rgba(255,255,255,.12); color: #b7b1c0; background: rgba(255,255,255,.055); box-shadow: none; cursor: default; filter: none; opacity: 1; }
      .shift-end-confirmation { grid-column: 1 / -1; display: grid !important; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(245,158,11,.34); border-radius: 10px; background: rgba(120,53,15,.18); }
      .shift-end-confirmation > span { min-width: 0; display: grid; gap: 4px; }
      .shift-end-confirmation > span strong { font-size: 15px; }
      .shift-end-confirmation > span small { color: #e7d7be; }
      .shift-end-confirmation > div { display: grid; grid-template-columns: repeat(2,minmax(112px,1fr)); gap: 8px; }
      .shift-end-confirmation button { min-height: 44px; padding: 0 13px; }
      .shift-end-confirmation button.shift-end-cancel { border: 1px solid rgba(255,255,255,.14); color: #fff; background: rgba(255,255,255,.07); }
      .shift-end-confirmation button.shift-end-confirm { border: 1px solid var(--dancr-color-danger-medium); color: #fee2e2; background: var(--dancr-color-danger-soft); }
      .shift-list-head { display: grid; gap: 4px; padding-top: 4px; }
      .shift-list-head strong { color: #fff; font-size: 18px; }
      .shift-list-head small { color: #b9accd; line-height: 1.45; }
      .check-row { min-height: 42px; display: flex !important; align-items: center; gap: 9px !important; padding-bottom: 10px; }
      .check-row input { width: 18px; height: 18px; }
      .dancer-photo-upload-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
      .photo-upload-heading { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .photo-upload-heading > span { min-width: 0; display: grid; gap: 3px; }
      .photo-upload-heading strong { color: #fff; font-size: 15px; }
      .photo-upload-heading small { color: #aca4b7; font-size: 12px; line-height: 1.4; }
      .photo-upload-heading > b { flex: 0 0 auto; padding: 5px 8px; border: 1px solid rgba(126,234,255,.22); border-radius: 999px; color: #b7effa; background: rgba(34,199,255,.07); font-size: 10px; white-space: nowrap; }
      .photo-primary-choice { min-width: 0; display: flex !important; align-items: center; gap: 9px !important; padding: 9px 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; color: #f4eff9; background: rgba(255,255,255,.035); cursor: pointer; }
      .photo-primary-choice input { width: 18px; height: 18px; flex: 0 0 18px; margin: 0; accent-color: #22c7ff; }
      .photo-primary-choice > span { min-width: 0; display: grid; gap: 2px; }
      .photo-primary-choice strong { font-size: 12px; }
      .photo-primary-choice small { color: #a69daf; font-size: 10px; line-height: 1.35; }
      .photo-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 10px; }
      .photo-source-action { position: relative; min-width: 0; min-height: 74px; height: 100%; display: grid !important; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 9px !important; overflow: hidden; padding: 10px; border: 1px solid rgba(126,234,255,.2); border-radius: 12px; color: #f8f5fb; background: linear-gradient(145deg,rgba(124,58,237,.13),rgba(34,199,255,.055)); box-sizing: border-box; cursor: pointer; }
      .photo-source-action:hover { border-color: rgba(126,234,255,.42); background: linear-gradient(145deg,rgba(124,58,237,.2),rgba(34,199,255,.09)); }
      .photo-source-action:focus-within { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .photo-source-action.is-disabled { opacity: .58; cursor: wait; }
      .photo-source-input { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; min-height: 0 !important; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
      .photo-source-input:disabled { cursor: wait; }
      .photo-source-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; color: #8beafa; background: rgba(34,199,255,.09); }
      .photo-source-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .photo-source-copy { min-width: 0; display: grid; gap: 2px; }
      .photo-source-copy strong { color: #fff; font-size: 13px; }
      .photo-source-copy small { color: #aaa2b4; font-size: 10px; line-height: 1.3; }
      .photo-source-cta { min-width: 60px; display: grid; place-items: center; padding: 5px 7px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #b8effa; background: rgba(34,199,255,.07); box-sizing: border-box; font-size: 9px; font-weight: 950; text-transform: uppercase; }
      .photo-upload-queue { display: grid; gap: 10px; margin-top: 12px; }
      .photo-review-card.is-uploading { border-color: rgba(34,211,238,.58); box-shadow: inset 3px 0 0 rgba(34,211,238,.88); }
      .photo-slot-summary { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #b9eff8; font-size: 11px; }
      .photo-slot-summary strong { color: #e7faff; font-size: 11px; }
      .photo-slot-summary span { color: #9a91a4; }
      .photo-upload-status { margin: 0; padding: 8px 10px; border-radius: 9px; color: #c9f5fc; background: rgba(34,199,255,.07); font-size: 11px; line-height: 1.4; }
      .photo-review-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
      .photo-review-card { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .photo-review-list .photo-review-card { grid-template-columns: minmax(0, 1fr); align-content: start; min-height: 310px; }
      .photo-review-list .photo-preview { width: 100%; aspect-ratio: 4 / 5; }
      .photo-review-card.is-pending { border-color: rgba(217,173,79,.58); background: rgba(217,173,79,.1); box-shadow: inset 3px 0 0 rgba(217,173,79,.88); }
      .photo-review-card.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .photo-review-card.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .photo-review-card span { display: grid; gap: 4px; }
      .photo-review-card strong { color: #fff; }
      .photo-review-card small { color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: .08em; }
      .photo-review-card em { color: #cfc5de; font-size: 13px; font-style: normal; line-height: 1.35; }
      .photo-review-card progress { width: 100%; height: 7px; accent-color: #7eeaff; }
      .photo-queue-actions, .photo-card-actions { display: flex !important; flex-wrap: wrap; gap: 7px !important; }
      .photo-card-actions { align-items: center; margin-top: 5px; }
      .photo-card-actions button, .photo-retry-button { min-height: 44px; padding: 0 11px; border: 1px solid rgba(34,211,238,.28); border-radius: 999px; color: #b5f1ff; background: rgba(34,211,238,.08); font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; }
      .photo-card-actions button:disabled, .photo-retry-button:disabled { opacity: .5; cursor: wait; }
      .photo-card-actions .photo-main-action { flex: 1 1 auto; min-width: 86px; min-height: 44px !important; padding: 0 13px !important; border-radius: 999px !important; font-size: 11px !important; white-space: nowrap; }
      .photo-card-actions .photo-order-action { width: 44px; min-width: 44px; max-width: 44px; min-height: 44px !important; padding: 0 !important; border-color: rgba(126,234,255,.2) !important; border-radius: 50% !important; color: #d5f8ff !important; background: rgba(126,234,255,.07) !important; box-shadow: none !important; font-size: 17px !important; }
      .photo-card-actions .photo-order-action:hover { border-color: rgba(126,234,255,.48) !important; background: rgba(126,234,255,.13) !important; }
      .photo-card-actions .photo-card-remove-action { flex: 0 0 auto; min-height: 44px !important; padding: 0 12px !important; border-color: rgba(255,104,124,.34) !important; border-radius: 999px !important; color: #ffbdc7 !important; background: rgba(255,104,124,.08) !important; box-shadow: none !important; font-size: 11px !important; }
      .photo-card-actions .photo-card-remove-action:hover { border-color: rgba(255,104,124,.62) !important; color: #ffe0e5 !important; background: rgba(255,104,124,.15) !important; }
      .photo-delete-button { width: fit-content; min-height: 36px; margin-top: 4px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.14); color: #ffd6dc; font: inherit; font-size: 13px; font-weight: 950; cursor: pointer; }
      .photo-delete-button:disabled { opacity: .62; cursor: wait; }
      .photo-preview { width: 96px; aspect-ratio: 3 / 4; display: grid; place-items: center; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,.12); color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; }
      .photo-preview:not(.empty) { filter: brightness(1.14) contrast(1.03); }
      .review-list { display: grid; gap: 10px; }
      .review-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .review-row span { color: #94e5ff; font-size: 13px; font-weight: 850; text-transform: capitalize; }
      .review-row.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .review-row.is-rejected strong, .review-row.is-rejected span { color: #ffb3bf; }
      .review-row.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .shift-list { display: grid; gap: 10px; }
      .dashboard-shift { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .dashboard-shift.is-deleting { opacity: .66; }
      .dashboard-shift span { display: grid; gap: 4px; }
      .dashboard-shift small { color: #b9accd; }
      .dashboard-shift em { width: fit-content; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(148,229,255,.22); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .dashboard-shift label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .dashboard-shift input, .dashboard-shift select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .dashboard-shift button { color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); padding: 0 12px; }
      .dashboard-shift button:disabled { cursor: wait; }
      .shift-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .shift-actions button:first-child { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.1); }
      .shift-panel-feedback { margin: 0; color: #94e5ff; font-size: 14px; line-height: 1.45; }
      .billing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .billing-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .billing-actions button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .billing-actions p { color: #94e5ff; font-size: 14px; }
      .account-summary-panel { align-content: start; }
      .account-summary-heading { display: flex !important; align-items: center; justify-content: space-between; gap: 12px !important; }
      .account-summary-heading h2, .support-panel-heading h2, .account-controls-heading h2 { margin: 0; }
      .account-status-pill { width: fit-content; min-height: 30px; display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #d7d1df; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .account-status-pill.is-active { border-color: rgba(52,211,153,.3); color: #86efac; background: rgba(6,78,59,.2); }
      .account-summary-list { display: grid; margin: 0; border-top: 1px solid rgba(255,255,255,.08); }
      .account-summary-list > div { min-width: 0; min-height: 52px; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .account-summary-list > div:last-child { border-bottom: 0; }
      .account-summary-list dt { color: #9f96ac; font-size: 12px; font-weight: 850; }
      .account-summary-list dd { min-width: 0; margin: 0; color: #f8f7fb; font-size: 15px; font-weight: 850; overflow-wrap: anywhere; }
      .account-controls-heading, .support-panel-heading { display: grid !important; gap: 5px !important; }
      .account-controls-heading p, .support-panel-heading p { margin: 0; color: #a9a1b3; font-size: 13px; line-height: 1.45; }
      .account-controls-panel { min-width: 0; grid-template-columns: minmax(0, 1fr); padding: 20px !important; border-radius: 22px !important; }
      .account-controls-panel .account-controls-heading { grid-template-columns: 36px minmax(0, 1fr); align-items: center; column-gap: 10px !important; row-gap: 10px !important; }
      .account-controls-heading h2 { font-size: 21px; line-height: 1.2; letter-spacing: -.025em; }
      .account-controls-heading > p { grid-column: 1 / -1; }
      .account-security-icon, .account-action-icon { box-sizing: border-box; width: 36px; height: 36px; display: grid !important; place-items: center; border: 1px solid rgba(176,137,240,.17); border-radius: 11px; color: #b89bdd; background: rgba(151,101,222,.065); }
      .account-security-icon > svg, .account-action-icon > svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      .account-actions { min-width: 0; display: grid !important; grid-template-columns: minmax(0, 1fr); gap: 0 !important; }
      .account-action-row { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 18px; padding: 18px 0; border-top: 1px solid rgba(255,255,255,.07); }
      .account-action-row > .account-action-details { min-width: 0; display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: start; gap: 12px; }
      .account-action-details > span:last-child { min-width: 0; display: grid; gap: 5px; }
      .account-action-icon.is-pause { color: #c2b4d3; border-color: rgba(194,180,211,.16); background: rgba(194,180,211,.045); }
      .account-action-icon.is-delete { color: #ed9baa; border-color: rgba(237,155,170,.16); background: rgba(185,68,94,.07); }
      .account-action-row strong { color: #f4f0f8; font-size: 15px; line-height: 1.3; }
      .account-action-row small { color: #a7a0b2; font-size: 12px; line-height: 1.5; }
      .account-action-button { min-width: 88px; min-height: 40px; border: 1px solid rgba(255,255,255,.13); border-radius: 10px; color: #f8f7fb; background: rgba(255,255,255,.055); font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; padding: 0 13px; }
      .account-action-button:hover { border-color: rgba(196,181,253,.4); background: rgba(124,58,237,.12); }
      .account-action-button:disabled { opacity: .55; cursor: wait; }
      .account-danger-row { margin-top: 2px; padding-bottom: 0; border-top-color: rgba(237,155,170,.16); }
      .account-actions .danger-button { color: #fecaca; background: rgba(127,29,29,.22); border-color: rgba(248,113,113,.28); }
      body.dancr-button-system .account-controls-panel .account-action-button { box-sizing: border-box !important; width: auto !important; min-width: 104px !important; min-height: 44px !important; margin: 0 !important; padding: 10px 16px !important; border: 1px solid rgba(185,151,236,.6) !important; border-radius: 11px !important; color: #fff !important; background: #292331 !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 3px 8px rgba(0,0,0,.18) !important; font-size: 12px !important; line-height: 1.3 !important; }
      body.dancr-button-system .account-controls-panel .account-action-button:hover:not(:disabled) { border-color: #b997ec !important; background: #362b46 !important; }
      body.dancr-button-system .account-controls-panel .account-action-button.danger-button { color: #ffd5de !important; border-color: #965368 !important; background: #40202b !important; }
      body.dancr-button-system .account-controls-panel .account-action-button.danger-button:hover:not(:disabled) { border-color: #e59aa9 !important; background: #552536 !important; }
      body.dancr-button-system .account-controls-panel .account-action-button:focus-visible { outline: 2px solid #c4b5fd !important; outline-offset: 3px !important; }
      .account-delete-confirmation { box-sizing: border-box; min-width: 0; display: grid !important; grid-template-columns: minmax(0, 1fr); gap: 10px !important; margin-top: 10px; padding: 13px; border: 1px solid rgba(248,113,113,.24); border-radius: 12px; background: rgba(69,10,10,.2); }
      .account-delete-confirmation label { color: #e7dce9; font-size: 12px; line-height: 1.45; }
      body.dancr-button-system .account-controls-panel .account-delete-confirmation label { font-size: 12px !important; font-weight: 500 !important; letter-spacing: normal !important; line-height: 1.5 !important; text-transform: none !important; }
      .account-delete-confirmation label strong { color: #fecaca; letter-spacing: .08em; }
      .account-delete-confirmation input { min-width: 0; width: 100%; max-width: 100%; min-height: 44px; box-sizing: border-box; padding: 0 12px; border: 1px solid rgba(248,113,113,.3); border-radius: 9px; color: #fff; background: rgba(5,5,7,.72); font: inherit; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .account-delete-confirmation input:focus-visible { outline: 2px solid #ef4444; outline-offset: 2px; }
      .account-delete-confirmation > div { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
      @media (max-width: 520px) { .account-controls-panel { padding: 16px !important; } .account-controls-heading h2 { font-size: 20px; } .account-controls-panel .account-action-row { grid-template-columns: minmax(0, 1fr); gap: 12px; padding-block: 16px; } .account-controls-panel .account-action-row:last-of-type { padding-bottom: 0; } body.dancr-button-system .account-controls-panel .account-action-row > .account-action-button { justify-self: start; margin-left: 48px !important; min-width: 116px !important; } .account-delete-confirmation > div { display: grid; grid-template-columns: minmax(0, 1fr); } body.dancr-button-system .account-controls-panel .account-delete-confirmation .account-action-button { width: 100% !important; } }
      .account-actions p { margin: 10px 0 0; color: #94e5ff; font-size: 14px; }
      .notification-title-row { display: flex !important; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px !important; }
      .notification-title-row > div { display: grid; gap: 4px; }
      .notification-toolbar { display: flex !important; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px !important; }
      .notification-unread-pill { min-height: 32px; display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid rgba(126,234,255,.2); border-radius: 999px; color: #9eeeff; background: rgba(126,234,255,.065); font-size: 11px; font-weight: 900; }
      .notification-mark-read-button { min-height: 36px; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; color: #f5f3f8; background: rgba(255,255,255,.045); font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0 12px; }
      .notification-mark-read-button:disabled, .notification-clear-button:disabled { opacity: .45; cursor: not-allowed; }
      .notification-list { display: grid; gap: 10px; }
      .notification-row { text-align: left; display: grid; gap: 4px; padding: 12px; border-radius: 12px; border: 1px solid rgba(126,234,255,.12); background: rgba(255,255,255,.035); color: #fff; cursor: pointer; text-decoration: none; }
      .notification-row:hover { border-color: rgba(126,234,255,.25); background: rgba(126,234,255,.06); }
      .notification-row.read { opacity: .58; }
      .notification-row span { color: #b9accd; }
      .notification-row .notification-row-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #7eeaff; font-size: 11px; }
      .notification-row-meta b { letter-spacing: .08em; text-transform: uppercase; }
      .notification-row-meta time { color: #a99fba; font-variant-numeric: tabular-nums; }
      .notification-row em { color: #7eeaff; font-size: 11px; font-style: normal; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .notification-clear-button { min-height: 38px; justify-self: end; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #c9c3d1; background: transparent; font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0 13px; }
      .notification-panel > p { margin: 0; color: #94e5ff; font-size: 13px; }
      #venue-support { scroll-margin-top: calc(var(--mydancr-preview-banner-offset, 0px) + 12px); }
      .support-panel form, .support-thread { display: grid; gap: 12px; }
      .support-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .support-panel input, .support-panel textarea { border-radius: 12px; border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.045); color: #fff; padding: 11px 13px; font: inherit; }
      .support-panel input { min-height: 46px; }
      .support-panel textarea { resize: vertical; }
      .support-panel button { min-height: 44px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #f8f7fb; background: rgba(255,255,255,.06); font: inherit; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .support-panel .support-send-button { border-color: rgba(196,181,253,.5); background: linear-gradient(135deg, #6d28d9, #4c1d95); box-shadow: 0 10px 24px rgba(76,29,149,.2); }
      .support-panel button:disabled { opacity: .62; cursor: wait; }
      .support-panel .support-send-button.is-sent { border: 1px solid var(--dancr-color-success-medium); color: #a7f3d0; background: var(--dancr-color-success-soft); box-shadow: inset 0 0 0 1px var(--dancr-color-success-soft), 0 0 18px var(--dancr-color-success-soft); }
      .support-thread-list { display: grid; gap: 10px; }
      .support-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-thread summary span { display: grid; gap: 3px; }
      .support-thread small { color: #b9accd; font-size: 12px; }
      .support-message-list { display: grid; gap: 8px; }
      .support-message { display: grid; gap: 4px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-message.from-admin { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .support-message p, .support-panel p { color: #cfc5de; font-size: 14px; line-height: 1.45; }
      .customer-settings-panel form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .customer-night-panel, .customer-saved-panel, .saved-deal-panel, .customer-dashboard-grid > .notification-panel, .customer-settings-section { grid-column: 1 / -1; scroll-margin-top: 82px; }
      .customer-saved-panel { display: grid; gap: 16px; }
      .customer-night-panel:focus, .customer-saved-panel:focus, .saved-deal-panel:focus, .customer-dashboard-grid > .notification-panel:focus, .customer-settings-section:focus { outline: 2px solid var(--mydancr-customer-accent); outline-offset: 4px; }
      .customer-section-heading { display: grid; gap: 4px; }
      .customer-section-heading > span, .customer-section-heading > div > span, .notification-title-row > div > span { color: var(--mydancr-customer-accent); font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .customer-section-heading h2, .notification-title-row h2 { margin: 0; }
      .customer-section-heading.split { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .customer-section-heading.split > div { display: grid; gap: 4px; }
      .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 28px; height: 26px; display: grid; place-items: center; padding: 0 8px; border: 1px solid rgba(196,181,253,.36); border-radius: 999px; color: #eee8ff; background: rgba(124,58,237,.28); font-size: 11px; }
      .customer-night-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px !important; }
      .customer-night-list > .customer-empty-state, .customer-night-list > .customer-loading-state { grid-column: 1 / -1; }
      .customer-night-card { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; overflow: hidden; border: 1px solid rgba(185,149,255,.25); border-radius: 22px; background: #101016; }
      .customer-night-identity { min-width: 0; display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 18px; padding: 18px 18px 16px; }
      .customer-night-portrait { height: 136px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: #0a090f; }
      .customer-night-portrait > .customer-saved-card-image { width: 100%; height: 100%; object-fit: cover; object-position: center 25%; }
      .customer-night-copy { min-width: 0; display: grid; align-content: center; gap: 5px; padding: 0; }
      .customer-saved-card-copy > span { color: var(--mydancr-customer-accent); font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .customer-night-copy h3 { margin: 0 0 3px; color: #fff; font-size: 25px; font-weight: 900; line-height: 1.12; letter-spacing: -.025em; overflow-wrap: anywhere; }
      .customer-night-copy p { margin: 0; line-height: 1.4; overflow-wrap: anywhere; }
      .customer-night-copy .customer-night-venue { color: #e4ddec; font-size: 14px; font-weight: 700; }
      .customer-night-copy .customer-night-location { color: #a29aaa; font-size: 12px; }
      .customer-night-date { min-width: 0; display: flex; align-items: flex-start; gap: 7px; margin-top: 8px; color: #c5a3f8; font-size: 12px; font-weight: 700; line-height: 1.5; }
      .customer-night-date > svg { width: 15px; height: 15px; flex: 0 0 15px; margin-top: 1px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
      .customer-night-controls { padding: 0 18px 5px; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-actions { display: grid !important; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-actions > :is(a, button) { box-sizing: border-box !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; min-width: 0 !important; min-height: 46px !important; margin: 0 !important; padding: 8px 5px !important; border: 1px solid rgba(255,255,255,.12) !important; border-radius: 12px !important; color: #ddd7e6 !important; background: rgba(255,255,255,.035) !important; box-shadow: none !important; font-size: 12px !important; line-height: 1.3 !important; text-align: center; text-decoration: none; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-actions > button { color: #eee2ff !important; border-color: rgba(178,125,255,.32) !important; background: linear-gradient(130deg, rgba(132,67,211,.22), rgba(106,55,171,.1)) !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-cancel { box-sizing: border-box !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 6px !important; width: 100% !important; min-width: 0 !important; min-height: 44px !important; margin: 3px 0 0 !important; padding: 8px !important; border: 0 !important; border-radius: 10px !important; color: #aaa1b6 !important; background: transparent !important; box-shadow: none !important; font-size: 11px !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-cancel > svg { width: 13px !important; height: 13px !important; fill: none !important; stroke: currentColor !important; stroke-width: 1.7; }
      body.dancr-button-system .dashboard-shell-customer .customer-night-cancel:hover:not(:disabled) { color: #f1c0cd !important; background: rgba(251,113,133,.05) !important; }
      .customer-night-controls :is(a, button):focus-visible { outline: 2px solid var(--mydancr-customer-accent); outline-offset: 2px; }
      .customer-night-controls button:disabled { opacity: .55; cursor: wait; }
      @media (max-width: 900px) { .customer-night-list { grid-template-columns: minmax(0, 1fr); } }
      @media (max-width: 620px) { .customer-night-card .customer-night-identity { grid-template-columns: 88px minmax(0, 1fr); gap: 14px; padding: 15px; } .customer-night-portrait { height: 120px; } .customer-night-card .customer-night-copy { padding: 0; } .customer-night-card .customer-night-copy h3 { font-size: 24px; } .customer-night-controls { padding-inline: 15px; } }
      .customer-followed-city-list { display: grid; gap: 16px; }
      .customer-followed-city-group { min-width: 0; display: grid; gap: 10px; }
      .customer-followed-city-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 7px; border-bottom: 1px solid rgba(167,139,250,.22); }
      .customer-followed-city-heading h3 { margin: 0; color: #fff; font-size: 18px; }
      .customer-followed-city-heading span { color: #cdbdff; font-size: 11px; font-weight: 900; }
      .customer-saved-card-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .customer-followed-dancer-card { min-width: 0; display: grid; align-content: start; gap: 6px; }
      .customer-dancer-unfollow { width: 100%; min-height: 44px; padding: 8px 4px; border: 1px solid rgba(255,255,255,.2); border-radius: 9px; color: #d7d5df; background: #17171d; font: inherit; font-size: 11px; font-weight: 800; cursor: pointer; }
      .customer-dancer-unfollow:hover:not(:disabled) { color: #fff; background: #24242c; }
      .customer-dancer-unfollow:focus-visible { outline: 2px solid var(--mydancr-customer-accent); outline-offset: 2px; }
      .customer-dancer-unfollow:disabled { opacity: .6; cursor: wait; }
      .customer-followed-dancer-tile { position: relative; min-width: 0; aspect-ratio: 1 / 1.68; overflow: hidden; border: 1px solid rgba(192,132,255,.34); border-radius: 14px; color: #fff; background: #07070a; box-shadow: 0 16px 34px rgba(0,0,0,.48), 0 0 14px rgba(155,92,255,.1); text-decoration: none; }
      .customer-followed-dancer-tile::after { content: ""; position: absolute; inset: 28% 0 0; z-index: 1; background: linear-gradient(180deg, transparent, rgba(10,6,17,.58) 34%, rgba(5,5,8,.98) 100%); pointer-events: none; }
      .customer-followed-dancer-tile:hover, .customer-followed-dancer-tile:focus-visible { border-color: rgba(192,132,255,.7); box-shadow: 0 20px 42px rgba(0,0,0,.56), 0 0 24px rgba(155,92,255,.24); }
      .customer-followed-dancer-tile:focus-visible { outline: 2px solid var(--mydancr-customer-accent); outline-offset: 3px; }
      .customer-followed-dancer-tile > .customer-saved-card-image { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; object-fit: cover; }
      .customer-followed-dancer-copy { position: absolute; inset: auto 0 0; z-index: 2; min-width: 0; display: grid; gap: 4px; padding: 44px 11px 12px; }
      .customer-followed-dancer-copy > strong, .customer-followed-dancer-copy > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .customer-followed-dancer-copy > strong { font-size: 18px; line-height: 1.05; }
      .customer-followed-dancer-copy > small { color: #d1c8df; font-size: 11px; }
      .customer-followed-dancer-copy > .customer-followed-dancer-time { color: #a9a0b8; font-size: 10px; }
      .customer-followed-dancer-status { width: fit-content; color: #a9a0b8; font-size: 9px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .customer-followed-dancer-status.is-working { color: #6ee7a6; text-shadow: 0 0 10px rgba(34,197,94,.34); }
      .customer-followed-dancer-status.is-upcoming { color: var(--mydancr-customer-accent); text-shadow: 0 0 10px rgba(139,92,246,.3); }
      .customer-saved-card { min-width: 0; overflow: hidden; border: 1px solid rgba(167,139,250,.2); border-radius: 12px; background: rgba(7,6,12,.78); }
      .customer-saved-card-image { width: 100%; height: 148px; display: grid; place-items: center; object-fit: cover; background: linear-gradient(145deg, #24143f, #09080f); color: #fff; font-size: 24px; font-weight: 950; }
      .customer-saved-card-copy { min-width: 0; display: grid; gap: 6px; padding: 12px; }
      .customer-saved-card-copy > a { min-width: 0; color: #fff; text-decoration: none; }
      .customer-saved-card-copy > a strong { display: block; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-saved-card-copy > small { overflow: hidden; color: #b9accd; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-card-actions { display: flex !important; flex-wrap: wrap; gap: 7px !important; margin-top: 4px; }
      .customer-card-actions a, .customer-card-actions button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 9px; color: #fff; background: rgba(255,255,255,.06); font: inherit; font-size: 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .customer-card-actions button:disabled { opacity: .55; cursor: wait; }
      .customer-card-actions button[aria-disabled="true"] { opacity: 1; cursor: default; }
      .customer-card-actions .customer-text-action { color: #cfc5de; background: transparent; }
      .customer-saved-card .customer-card-actions { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .customer-saved-card .customer-card-actions > * { min-width: 0; width: 100%; padding-inline: 7px; }
      .customer-saved-card-grid.customer-favorite-club-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .customer-favorite-club-card { border: 1px solid rgba(185,149,255,.22); border-radius: 16px; background: linear-gradient(155deg, #141019, #09090e 72%); box-shadow: 0 8px 22px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.04); }
      .customer-favorite-club-header { display: grid; grid-template-columns: 124px minmax(0, 1fr) 36px; align-items: center; gap: 10px; padding: 12px 12px 0; }
      .customer-favorite-club-brand { min-width: 0; height: 68px; overflow: hidden; border: 1px solid rgba(172,122,255,.12); border-radius: 10px; background: #050507; }
      .customer-favorite-club-logo { height: 100%; display: grid; place-items: center; padding: 0; }
      .customer-favorite-club-logo > img { display: block; width: 100%; height: 100%; max-height: 66px; object-fit: contain; }
      .customer-favorite-club-identity { min-width: 0; display: grid; gap: 4px; }
      .customer-favorite-club-identity > a { color: #fff; text-decoration: none; }
      .customer-favorite-club-identity strong { display: block; font-size: 17px; font-weight: 900; letter-spacing: -.02em; line-height: 1.2; overflow-wrap: anywhere; }
      .customer-favorite-club-identity > small { color: #aaa4b8; font-size: 11px; line-height: 1.35; }
      .customer-club-logo-fallback { width: 34px; height: 34px; fill: none; stroke: #b7accb; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .customer-club-favorite { width: 36px; height: 36px; min-height: 36px; display: grid; place-items: center; padding: 8px; border: 1px solid rgba(251,113,133,.24); border-radius: 50%; color: #fb7185; background: rgba(27,15,24,.9); cursor: pointer; }
      .customer-club-favorite > svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; stroke-width: 1.4; }
      .customer-club-favorite:disabled { opacity: .55; cursor: wait; }
      .customer-club-favorite:hover:not(:disabled) { background: #351724; border-color: #fb7185; }
      body.dancr-button-system .dashboard-shell-customer .customer-club-favorite { box-sizing: border-box !important; width: 36px !important; min-width: 36px !important; height: 36px !important; min-height: 36px !important; padding: 8px !important; border: 1px solid rgba(239,68,68,.28) !important; border-radius: 50% !important; color: #ef4444 !important; background: rgba(27,15,24,.9) !important; box-shadow: none !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-club-favorite svg { width: 18px !important; height: 18px !important; color: inherit !important; }
      body.dancr-button-system .dashboard-shell-customer .customer-club-favorite svg path { fill: currentColor !important; stroke: currentColor !important; }
      .customer-club-favorite:focus-visible, .customer-club-activity-stat:focus-visible, .customer-favorite-club-logo:focus-visible { outline: 2px solid var(--mydancr-customer-accent); outline-offset: -3px; }
      .customer-favorite-club-copy { padding: 10px 12px 12px; gap: 8px; }
      .customer-club-activity { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
      .customer-club-activity-stat { box-sizing: border-box; min-width: 0; min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 5px 10px; border: 1px solid rgba(255,255,255,.07); border-radius: 8px; color: #c0b9ce; background: rgba(255,255,255,.025); text-decoration: none; }
      .customer-club-activity-stat strong { color: inherit; font-size: 14px; line-height: 1; }
      .customer-club-activity-stat span { font-size: 11px; font-weight: 800; }
      .customer-club-activity-stat > i { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: currentColor; }
      .customer-club-activity-stat > svg { width: 13px; height: 13px; flex: 0 0 13px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
      .customer-club-activity-stat.is-now { color: var(--dancr-color-live, #4dec9d); border-color: var(--dancr-color-live-medium, rgba(77,236,157,.36)); background: var(--dancr-color-live-soft, rgba(77,236,157,.1)); }
      .customer-club-activity-stat.is-now.has-dancers > i { box-shadow: 0 0 9px rgba(65,211,136,.6); }
      .customer-club-activity-stat.is-upcoming { color: var(--dancr-color-info, #22d3ee); border-color: var(--dancr-color-info-medium, rgba(34,211,238,.34)); background: var(--dancr-color-info-soft, rgba(34,211,238,.1)); }
      .customer-favorite-club-copy > .customer-club-activity-unavailable { white-space: normal; font-size: 11px; line-height: 1.5; }
      .customer-favorite-club-card .customer-favorite-club-actions { display: flex !important; flex-wrap: wrap; justify-content: flex-start; gap: 8px !important; margin-top: 0; }
      .customer-favorite-club-card .customer-favorite-club-actions > * { min-height: 34px; border-radius: 8px; font-size: 11px; }
      .customer-favorite-club-actions > a { gap: 8px; color: #f0e7ff; border-color: rgba(178,125,255,.3); background: linear-gradient(130deg, rgba(132,67,211,.2), rgba(106,55,171,.09)); }
      body.dancr-button-system .customer-favorite-club-card .customer-favorite-club-actions > :is(a, button) { box-sizing: border-box !important; flex: 0 0 auto !important; width: auto !important; min-width: 0 !important; min-height: 34px !important; margin: 0 !important; padding: 0 12px !important; border: 1px solid rgba(255,255,255,.12) !important; border-radius: 8px !important; color: #e4e0ed !important; background: rgba(255,255,255,.04) !important; box-shadow: none !important; font-size: 11px !important; }
      body.dancr-button-system .customer-favorite-club-card .customer-favorite-club-actions > a { border-color: rgba(178,125,255,.3) !important; color: #f0e7ff !important; background: linear-gradient(130deg, rgba(132,67,211,.2), rgba(106,55,171,.09)) !important; }
      @media (max-width: 700px) { .customer-saved-card-grid.customer-favorite-club-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
      @media (max-width: 380px) { .customer-favorite-club-header { grid-template-columns: 104px minmax(0, 1fr) 36px; gap: 8px; } .customer-favorite-club-identity strong { font-size: 16px; } }
      .customer-empty-state { min-height: 124px; display: grid; place-items: start; align-content: center; gap: 9px; padding: 16px; border: 1px dashed rgba(167,139,250,.3); border-radius: 12px; background: rgba(139,92,246,.05); }
      .customer-empty-state.compact { min-height: 106px; padding: 12px; }
      .customer-empty-state strong { color: #fff; }
      .customer-empty-state p { color: #b9accd; font-size: 13px; line-height: 1.45; }
      .customer-empty-state a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 9px; color: #fff; background: #6d28d9; font-size: 12px; font-weight: 950; text-decoration: none; }
      .customer-loading-state { min-height: 112px; display: grid; place-items: center; color: #b9accd; }
      .saved-deal-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .saved-deal-head > div { display: grid; gap: 4px; }
      .saved-deal-head span { color: var(--mydancr-customer-accent); font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .saved-deal-head h2 { margin: 0; }
      .saved-deal-head > strong { min-width: 28px; height: 26px; display: grid; place-items: center; padding: 0 8px; border: 1px solid rgba(196,181,253,.36); border-radius: 999px; color: #eee8ff; background: rgba(124,58,237,.28); font-size: 11px; }
      .saved-deal-privacy-note { max-width: none; margin: 10px 0 0; color: #b9accd; font-size: 13px; line-height: 1.45; }
      .saved-deal-bookmark { align-items: start; }
      .saved-deal-bookmark > .customer-card-actions { justify-content: flex-end; margin-top: 0; }
      .customer-deal-activity { margin-top: 18px; border-top: 1px solid rgba(255,255,255,.09); padding-top: 8px; }
      .customer-deal-activity > summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #d8cfeb; font-size: 14px; font-weight: 900; cursor: pointer; list-style: none; }
      .customer-deal-activity > summary::-webkit-details-marker { display: none; }
      .customer-deal-activity > summary::after { content: "+"; width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; color: #fff; background: rgba(255,255,255,.08); font-size: 20px; }
      .customer-deal-activity[open] > summary::after { content: "−"; }
      .customer-deal-activity > summary > strong { margin-left: auto; color: var(--mydancr-customer-accent); font-size: 12px; }
      .customer-nfc-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
      .customer-nfc-guide > div { min-width: 0; display: flex; gap: 10px; padding: 12px; border: 1px solid rgba(167,139,250,.22); border-radius: 12px; background: linear-gradient(145deg, rgba(109,40,217,.14), rgba(255,255,255,.025)); }
      .customer-nfc-guide > div > b { width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; color: #fff; background: #6d28d9; font-size: 12px; }
      .customer-nfc-guide span { min-width: 0; display: grid; gap: 4px; }
      .customer-nfc-guide small { color: #b9accd; font-size: 11px; line-height: 1.4; }
      .saved-deal-list { display: grid; gap: 9px; margin-top: 14px; }
      .saved-deal-list > p { margin: 0; color: #b9accd; font-size: 14px; line-height: 1.45; }
      .saved-deal-item { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid rgba(167,139,250,.3); border-radius: 10px; color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.22), rgba(255,255,255,.035)); text-decoration: none; }
      .saved-deal-item > span { min-width: 0; display: grid; gap: 4px; }
      .saved-deal-item > span > strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .saved-deal-item small { color: #b9accd; font-size: 12px; }
      .saved-deal-item em { color: var(--mydancr-customer-accent); font-size: 12px; font-style: normal; font-weight: 950; }
      .saved-deal-item.unavailable { opacity: .62; border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.035); }
      .past-deal-history { margin-top: 4px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 10px; }
      .past-deal-history summary { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #d8cfeb; font-weight: 900; cursor: pointer; list-style: none; }
      .past-deal-history summary::-webkit-details-marker { display: none; }
      .past-deal-history summary span { min-width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.08); }
      .past-deal-history > div { display: grid; gap: 8px; padding-top: 8px; }
      .customer-settings-section { display: grid; gap: var(--mydancr-dashboard-gap); padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: var(--mydancr-dashboard-radius); background: var(--mydancr-dashboard-panel); }
      .customer-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--mydancr-dashboard-gap); }
      .customer-settings-grid > .info-panel { grid-column: auto; border-color: transparent; background: var(--mydancr-dashboard-panel-raised); }
      .customer-settings-grid > .customer-settings-panel, .customer-settings-grid > .support-panel, .customer-settings-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-settings-panel .city-field { grid-column: span 2; }
      .customer-unavailable-follow { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px; border: 1px solid #ffffff15; border-radius: 14px; background: #ffffff05; }
      .customer-unavailable-follow strong { font-size: 14px; }
      .customer-unavailable-follow p { margin: 5px 0 0; color: #aaa3b8; font-size: 12px; line-height: 1.45; }
      .customer-unavailable-follow button { flex: 0 0 auto; min-height: 44px; padding: 10px 14px; font-size: 12px; }
      .customer-alert-preferences-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .customer-alert-preferences-heading > div { display: grid; gap: 4px; }
      .customer-alert-preferences-heading > div > span { color: #c084fc; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .customer-alert-preferences-heading h2 { margin: 0; }
      .customer-notification-preferences { display: grid; gap: 18px; }
      .customer-notification-preferences .customer-alert-preferences-heading p, .customer-notification-preferences .customer-delivery-heading p { margin: 6px 0 0; color: #aaa3b8; font-size: 13px; line-height: 1.5; }
      .customer-preference-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
      .customer-preference-row { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) 76px; align-items: center; gap: 12px; padding: 15px; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: rgba(255,255,255,.025); }
      .customer-preference-row > span { display: grid; min-width: 0; gap: 5px; }
      .customer-preference-row strong { color: #f5f2fa; font-size: 14px; line-height: 1.3; }
      .customer-preference-row small { color: #aaa3b8; font-size: 12px; line-height: 1.5; }
      .customer-preference-master { border-color: rgba(192,132,252,.2); background: linear-gradient(115deg,rgba(124,58,237,.12),rgba(124,58,237,.025)); }
      .customer-settings-panel button.customer-notification-switch { display: flex !important; align-items: center !important; justify-content: center !important; gap: 7px !important; width: 76px !important; min-width: 76px !important; height: 44px !important; min-height: 44px !important; padding: 0 !important; border: 0 !important; border-radius: 9px !important; background: transparent !important; box-shadow: none !important; color: #bdb6cb !important; cursor: pointer; }
      .customer-switch-track { box-sizing: border-box; position: relative; display: block; width: 42px; height: 24px; flex: 0 0 42px; border: 1px solid #666170; border-radius: 999px; background: #34303e; transition: background .18s ease,border-color .18s ease; }
      .customer-switch-track i { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #e3dfeb; box-shadow: 0 1px 4px #0005; transform: translateX(0); transition: transform .18s ease; }
      .customer-notification-switch[aria-checked="true"] .customer-switch-track { border-color: #a478ed; background: #7c3aed; }
      .customer-notification-switch[aria-checked="true"] .customer-switch-track i { transform: translateX(18px); background: #fff; }
      .customer-switch-state { width: 23px; font-size: 11px; font-weight: 750; text-align: left; }
      .customer-settings-panel button.customer-notification-switch[aria-checked="true"] { color: #e9d5ff !important; }
      .customer-settings-panel button.customer-notification-switch:focus-visible { outline: 2px solid #d8b4fe !important; outline-offset: 3px; }
      .customer-settings-panel button.customer-notification-switch:disabled { cursor: not-allowed; opacity: .5; }
      .customer-settings-panel button.customer-notification-switch[aria-busy="true"] { cursor: progress; }
      .customer-delivery-heading { padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); }
      .customer-delivery-heading h3 { margin: 12px 0 0; color: #f5f2fa; font-size: 15px; }
      .customer-settings-panel button.customer-push-device-button { grid-column: 1 / -1; padding: 10px 16px; border: 1px solid #7550ad !important; border-radius: 12px !important; color: #e9d5ff !important; background: #28133f !important; font-size: 13px; }
      @media (prefers-reduced-motion: reduce) { .customer-switch-track, .customer-switch-track i { transition: none; } }
      .customer-settings-panel .customer-alert-preferences-copy { margin: 0; color: var(--mydancr-dashboard-muted); font-size: 13px; line-height: 1.45; }
      .customer-settings-panel .customer-alert-status { margin: 0; color: #d8b4fe; }
      .venue-working-list { display: grid; gap: 9px; }
      .venue-working-list a { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); color: #fff; background: rgba(255,255,255,.04); text-decoration: none; }
      .venue-working-list a:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-working-identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .venue-working-identity > img, .venue-working-identity > i { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; object-fit: cover; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; color: #f8fafc; background: #111118; font-style: normal; font-weight: 900; }
      .venue-working-identity > span, .venue-working-verification { min-width: 0; display: grid; gap: 3px; }
      .venue-working-identity strong { overflow: hidden; color: #f8fafc; text-overflow: ellipsis; white-space: nowrap; }
      .venue-working-list small { color: var(--mydancr-dashboard-muted); font-size: 10px; }
      .venue-working-verification { justify-items: end; text-align: right; }
      .venue-working-verification > strong { color: #76f0c8; font-size: 11px; }
      .venue-analytics-period { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; padding: 5px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #050507; }
      .venue-analytics-period button { min-height: 40px; border: 1px solid transparent; border-radius: 9px; color: var(--mydancr-dashboard-muted); background: transparent; font: inherit; font-size: 12px; font-weight: 850; cursor: pointer; }
      .venue-analytics-period button.active { border-color: rgba(124,58,237,.58); color: #f8fafc; background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.22); }
      .venue-analytics-period button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-analytics-metric small { color: var(--mydancr-dashboard-muted); font-size: 9px; line-height: 1.25; }
      .venue-analytics-metric small.positive { color: #6ee7b7; }
      .venue-analytics-metric small.negative { color: #fca5a5; }
      .venue-deal-readonly { min-width: 0; display: grid; gap: 12px; scroll-margin-top: 120px; font-size: 14px; line-height: 1.5; }
      .venue-deal-readonly:focus { outline: 2px solid rgba(124,58,237,.7); outline-offset: 3px; }
      .venue-contract-deal-list { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,240px),1fr)); gap: 10px; }
      .venue-contract-deal-list > section { min-width: 0; display: grid; align-content: start; gap: 8px; padding: 14px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #0d0d12; }
      .venue-contract-deal-list > section.is-live { border-color: rgba(16,185,129,.36); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-contract-deal-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .venue-contract-deal-title h3 { min-width: 0; margin: 0; color: #f8fafc; font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; }
      .venue-contract-deal-state { flex-shrink: 0; padding: 3px 8px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 999px; color: #cbd5e1; font-size: 11px; font-weight: 800; }
      .is-live .venue-contract-deal-state { border-color: rgba(16,185,129,.3); color: #6ee7b7; background: rgba(16,185,129,.08); }
      .venue-contract-deal-list p, .venue-deal-redemption-guide p { margin: 0; color: #cbd5e1; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
      .venue-contract-deal-terms { border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-contract-deal-terms > summary, .venue-deal-redemption-guide > summary { min-height: 44px; align-content: center; color: #ddd6fe; font-size: 13px; font-weight: 750; cursor: pointer; }
      .venue-contract-deal-terms > summary:focus-visible, .venue-deal-redemption-guide > summary:focus-visible, .venue-deal-request-actions > button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 3px; border-radius: 4px; }
      .venue-contract-deal-terms small { display: block; margin-top: 8px; color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .venue-deal-redemption-guide { padding: 0 2px; }
      .venue-deal-redemption-guide ol { display: grid; gap: 6px; margin: 0 0 10px; padding-left: 22px; color: #cbd5e1; }
      .venue-contract-empty { min-height: 90px; place-content: center; }
      .venue-contract-preview { width: fit-content; max-width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 16px; border: 1px solid rgba(124,58,237,.54); border-radius: 9px; color: #f8fafc; background: #7c3aed; font-size: 14px; font-weight: 800; text-decoration: none; }
      .venue-contract-preview-note { margin: 0; color: var(--dancr-color-text-secondary); font-size: 13px; line-height: 1.45; }
      .venue-deal-request-center { display: grid; gap: 10px; padding-top: 16px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-request-center h3, .venue-deal-request-center p { margin: 0; }
      .venue-deal-request-center h3 { font-size: 14px; }
      .venue-deal-request-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .venue-deal-request-actions > button, .venue-deal-request-center form button { min-height: 44px; padding: 8px 12px; border: 1px solid rgba(124,58,237,.55); border-radius: 9px; background: #7c3aed; color: #f8fafc; font: inherit; font-weight: 750; cursor: pointer; }
      .venue-deal-request-actions > button { flex: 1 1 150px; background: transparent; border-color: var(--mydancr-dashboard-border); font-size: 13px; }
      .venue-deal-request-actions > button:hover { background: rgba(124,58,237,.12); }
      .venue-deal-request-actions > button:disabled { opacity: .5; cursor: wait; }
      .venue-deal-request-actions > small { color: var(--mydancr-dashboard-muted); }
      .venue-deal-request-center > form { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(180px,.7fr) minmax(240px,1.3fr); gap: 10px; padding-top: 12px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-request-center form label { display: grid; gap: 7px; color: #cbd5e1; font-size: 12px; font-weight: 850; }
      .venue-deal-request-center form select, .venue-deal-request-center form textarea { width: 100%; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; background: #111118; color: #f8fafc; font: inherit; }
      .venue-deal-request-center form select { min-height: 46px; padding: 0 12px; }
      .venue-deal-request-center form textarea { min-height: 104px; padding: 12px; resize: vertical; }
      .venue-deal-request-center form button { grid-column: 1 / -1; width: fit-content; }
      .venue-deal-request-center > small { grid-column: 1 / -1; color: #cbd5e1; }
      .venue-deal-request-feedback { grid-column: 1 / -1; display: grid; grid-template-columns: 34px minmax(0,1fr); align-items: center; gap: 10px; padding: 12px; border: 1px solid #334155; border-radius: 10px; color: #cbd5e1; background: #111118; }
      .venue-deal-request-feedback > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 999px; color: #f8fafc; background: #334155; font-weight: 950; }
      .venue-deal-request-feedback > div { display: grid; gap: 3px; }
      .venue-deal-request-feedback strong, .venue-deal-request-feedback p { margin: 0; }
      .venue-deal-request-feedback strong { color: #f8fafc; font-size: 13px; }
      .venue-deal-request-feedback p { color: #cbd5e1; font-size: 12px; line-height: 1.4; }
      .venue-deal-request-feedback.is-success { border-color: rgba(16,185,129,.52); background: rgba(16,185,129,.08); }
      .venue-deal-request-feedback.is-success > span { color: #050507; background: #10b981; }
      .venue-deal-request-feedback.is-error { border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.08); }
      .venue-deal-request-feedback.is-error > span { background: #ef4444; }
      .venue-deal-request-history { grid-column: 1 / -1; display: grid; gap: 8px; }
      .venue-deal-request-history article { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px 12px; padding: 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; background: #111118; }
      .venue-deal-request-history article.is-confirmed { border-color: rgba(16,185,129,.42); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-deal-request-history article > div { display: grid; gap: 2px; }
      .venue-deal-request-history small { color: #94a3b8; }
      .venue-deal-request-history article > span { align-self: start; padding: 5px 8px; border: 1px solid #334155; border-radius: 999px; color: #cbd5e1; font-size: 10px; font-weight: 900; }
      .venue-deal-request-history article > span[data-status="approved"] { border-color: rgba(16,185,129,.5); color: #6ee7b7; }
      .venue-deal-request-history article > span[data-status="rejected"] { border-color: rgba(239,68,68,.45); color: #fca5a5; }
      .venue-deal-request-history article > p { grid-column: 1 / -1; color: #cbd5e1; font-size: 12px; line-height: 1.45; }
      .venue-contract-history { border: 1px solid var(--mydancr-dashboard-border); border-radius: 10px; background: #0d0d12; }
      .venue-contract-history > summary { min-height: 48px; display: flex; align-items: center; padding: 0 14px; color: #f8fafc; font-weight: 900; cursor: pointer; }
      .venue-contract-history > div { display: grid; gap: 8px; padding: 0 14px 14px; }
      .venue-contract-history section { display: grid; grid-template-columns: minmax(150px,.7fr) minmax(180px,1.3fr) auto; gap: 10px; padding: 11px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 8px; background: #111118; }
      .venue-contract-history span, .venue-contract-history small { color: #94a3b8; }
      .venue-deal-panel { grid-column: span 3; border-color: var(--mydancr-dashboard-border); background: #111118; }
      .venue-deal-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .venue-deal-heading > div { display: grid; gap: 4px; }
      .deal-state { width: fit-content; padding: 7px 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #b9accd; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      .deal-state.active { border-color: rgba(50,255,164,.42); color: #78ffc0; background: rgba(50,255,164,.1); }
      .venue-deal-panel > p, .venue-redemption-instructions p { color: #cfc5de; line-height: 1.5; }
      .venue-deal-placement-note { margin: 0; color: #94e5ff !important; font-size: 14px; font-weight: 800; }
      .venue-deal-control-card { display: grid; grid-template-columns: minmax(0,1.25fr) minmax(260px,.75fr); gap: 16px; padding: 16px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: #0d0d12; }
      .venue-deal-control-card.is-live { border-color: rgba(16,185,129,.34); box-shadow: inset 3px 0 0 rgba(16,185,129,.72); }
      .venue-deal-control-status { display: grid; align-content: center; gap: 5px; }
      .venue-deal-control-status > span { color: #94a3b8; font-size: 10px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .venue-deal-control-card.is-live .venue-deal-control-status > span { color: #6ee7b7; }
      .venue-deal-control-status > strong { color: #f8fafc; font-size: clamp(18px,3vw,24px); line-height: 1.15; overflow-wrap: anywhere; }
      .venue-deal-control-status > small { color: #94a3b8; line-height: 1.45; }
      .venue-deal-live-list { display: grid; gap: 7px; margin-top: 7px; }
      .venue-deal-live-list > button { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 11px; border: 1px solid rgba(16,185,129,.28); border-radius: 9px; color: #f8fafc; background: rgba(16,185,129,.07); text-align: left; cursor: pointer; }
      .venue-deal-live-list > button > span { min-width: 0; display: grid; gap: 2px; }
      .venue-deal-live-list > button strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
      .venue-deal-live-list > button small { color: #94a3b8; font-size: 10px; }
      .venue-deal-live-list > button em { color: #6ee7b7; font-size: 11px; font-style: normal; font-weight: 900; }
      .venue-deal-live-list > button:focus-visible { outline: 2px solid #10b981; outline-offset: 2px; }
      .venue-deal-control-metrics { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 11px; background: #09090d; }
      .venue-deal-control-metrics > span { min-width: 0; display: grid; gap: 5px; padding: 12px; border-left: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-control-metrics > span:first-child { border-left: 0; }
      .venue-deal-control-metrics small { color: #94a3b8; font-size: 10px; font-weight: 800; }
      .venue-deal-control-metrics strong { color: #f8fafc; font-size: 17px; overflow-wrap: anywhere; }
      .venue-deal-control-actions { display: flex; flex-wrap: wrap; align-content: center; justify-content: flex-end; gap: 9px; }
      .venue-deal-control-actions > button, .venue-deal-control-actions > a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 15px; border: 1px solid var(--mydancr-dashboard-border); border-radius: 9px; color: #f8fafc; background: #17171d; font-size: 13px; font-weight: 900; text-decoration: none; }
      .venue-deal-control-actions > button.venue-deal-control-primary { border-color: rgba(196,181,253,.54); background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.18); }
      .venue-deal-control-actions > button:focus-visible, .venue-deal-control-actions > a:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
      .venue-deal-editor, .venue-deal-performance { overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 12px; background: #0d0d12; }
      .venue-deal-editor { border-color: rgba(139,92,246,.44); background: linear-gradient(105deg, rgba(32,22,54,.94), rgba(13,13,18,.98) 68%); box-shadow: inset 0 0 0 1px rgba(196,181,253,.05), 0 8px 24px rgba(0,0,0,.18); }
      .venue-deal-editor > summary, .venue-deal-performance > summary { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 15px; color: #f8fafc; cursor: pointer; list-style: none; }
      .venue-deal-editor > summary { min-height: 74px; padding: 8px 14px 8px 16px; border-left: 3px solid #8b5cf6; transition: background .18s ease, border-color .18s ease; }
      .venue-deal-editor > summary:hover { background: rgba(139,92,246,.09); }
      .venue-deal-editor > summary:focus-visible { outline: 2px solid #a78bfa; outline-offset: -3px; }
      .venue-deal-editor > summary::-webkit-details-marker, .venue-deal-performance > summary::-webkit-details-marker { display: none; }
      .venue-deal-editor > summary > span, .venue-deal-performance > summary > span { display: grid; gap: 3px; }
      .venue-deal-editor > summary strong { font-size: 16px; line-height: 1.15; }
      .venue-deal-editor > summary small, .venue-deal-performance > summary small { color: #94a3b8; font-size: 11px; }
      .venue-deal-editor > summary small { color: #c2bcd0; font-size: 12px; line-height: 1.25; }
      .venue-deal-editor > summary em { padding: 6px 9px; border: 1px solid rgba(196,181,253,.23); border-radius: 999px; color: #ddd6fe; background: rgba(139,92,246,.12); font-size: 11px; font-style: normal; font-weight: 900; white-space: nowrap; }
      .venue-deal-editor > summary::after, .venue-deal-performance > summary::after { content: "+"; color: #c4b5fd; font-size: 22px; line-height: 1; }
      .venue-deal-editor > summary::after { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 1px solid rgba(196,181,253,.45); border-radius: 999px; background: rgba(124,58,237,.26); box-shadow: 0 0 15px rgba(124,58,237,.22); }
      .venue-deal-editor[open] > summary::after, .venue-deal-performance[open] > summary::after { content: "−"; }
      .venue-deal-editor[open] > summary { border-left-color: #c4b5fd; background: rgba(139,92,246,.11); }
      .venue-deal-editor > summary > em { margin-left: auto; }
      .venue-deal-editor-body, .venue-deal-performance-body { display: grid; gap: 14px; padding: 0 14px 14px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .venue-deal-editor-body > .venue-deal-placement-note, .venue-deal-performance-body > :first-child { margin-top: 14px; }
      .venue-deal-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .venue-deal-list > button { min-height: 92px; display: grid; align-content: center; justify-items: start; gap: 4px; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; color: #fff; background: rgba(255,255,255,.04); text-align: left; }
      .venue-deal-list > button.selected { border: 2px solid var(--dancr-color-beam-violet) !important; background: var(--dancr-color-beam-violet-soft) !important; box-shadow: inset 4px 0 0 var(--dancr-color-beam-violet) !important; }
      .venue-deal-list > button.add { border-style: dashed; color: #78ffc0; }
      .venue-deal-list span { color: #78ffc0; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-deal-list strong { font-size: 14px; }
      .venue-deal-list small { color: #a99fba; font-size: 11px; }
      .venue-deal-counts { display: flex; flex-wrap: wrap; gap: 8px; }
      .venue-deal-counts span { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 1px solid rgba(255,255,255,.11); border-radius: 999px; color: #b9accd; background: rgba(255,255,255,.035); font-size: 12px; font-weight: 850; }
      .venue-deal-counts strong { color: #fff; font-size: 15px; }
      .venue-deal-builder-step legend > span:first-child { width: 26px; height: 26px; flex: 0 0 26px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #94e5ff; font-size: 12px; font-weight: 950; }
      .venue-deal-panel form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .venue-deal-builder-step { min-width: 0; grid-column: 1 / -1; display: grid; gap: 14px; margin: 0; padding: 15px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(255,255,255,.025); }
      .venue-deal-builder-step legend { display: flex; align-items: center; gap: 10px; padding: 0 8px; color: #fff; }
      .venue-deal-builder-step legend > span:last-child { display: grid; gap: 2px; }
      .venue-deal-builder-step legend strong { font-size: 15px; }
      .venue-deal-builder-step legend small { color: #a99fba; font-size: 11px; font-weight: 750; }
      .venue-deal-step-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .venue-deal-step-grid.one-column { grid-template-columns: 1fr; }
      .deal-wide-field { grid-column: 1 / -1; }
      .venue-deal-builder-step.review { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.025); }
      .venue-deal-review { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin: 0; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; background: rgba(255,255,255,.1); }
      .venue-deal-review > div { min-width: 0; display: grid; gap: 4px; padding: 11px 12px; background: #0d0c12; }
      .venue-deal-review dt { color: #9d92ad; font-size: 10px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .venue-deal-review dd { margin: 0; color: #fff; font-size: 13px; font-weight: 850; overflow-wrap: anywhere; }
      .venue-deal-rule-note { margin: 0; padding: 12px; border-left: 3px solid #94e5ff; color: #cbd5e1; background: rgba(148,229,255,.045); font-size: 12px; line-height: 1.5; }
      .venue-referral-agreement { min-width: 0; display: grid; align-content: start; gap: 7px; padding: 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: #111118; }
      .venue-referral-agreement > span { color: #9d92ad; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-referral-agreement > strong { color: #fff; font-size: 16px; overflow-wrap: anywhere; }
      .venue-referral-agreement > small { color: #b9accd; line-height: 1.45; }
      .venue-referral-agreement > em { padding: 9px 10px; border: 1px solid rgba(255,214,102,.25); border-radius: 8px; color: #ffd666; background: rgba(255,214,102,.07); font-size: 12px; font-style: normal; font-weight: 850; line-height: 1.4; }
      .venue-referral-agreement > button { justify-self: start; min-height: 38px; }
      .venue-referral-request-panel { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(160px,.7fr) minmax(220px,1.3fr) auto; align-items: end; gap: 10px; padding: 13px; border: 1px solid rgba(148,229,255,.24); border-radius: 10px; background: rgba(148,229,255,.045); }
      .venue-referral-request-panel > button { min-height: 42px; }
      .venue-deal-panel label { display: grid; align-content: start; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-deal-panel input, .venue-deal-panel textarea, .venue-deal-panel select { width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #17151d; padding: 10px 12px; font: inherit; }
      .venue-deal-panel input, .venue-deal-panel select { min-height: 42px; }
      .venue-deal-panel textarea { resize: vertical; }
      .venue-deal-panel button { min-height: 44px; border: 0; border-radius: 8px; color: #061015; background: #78ffc0; font: inherit; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .venue-deal-panel button:disabled { opacity: .62; cursor: wait; }
      .deal-booking-url { grid-column: 1 / -1; }
      .venue-deal-builder-step label > small { color: #a99fba; font-weight: 650; line-height: 1.4; }
      .deal-booking-url small { color: #94e5ff; font-weight: 650; line-height: 1.45; }
      .venue-deal-form-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .venue-deal-live-edit-note { grid-column: 1 / -1; margin: 0; padding: 11px 12px; border-left: 3px solid #78ffc0; color: #dfffee; background: rgba(50,255,164,.055); font-size: 12px; font-weight: 800; line-height: 1.45; }
      .venue-deal-unpublish-note { grid-column: 1 / -1; color: #a99fba; font-size: 11px; font-weight: 700; line-height: 1.4; }
      .venue-deal-form-actions .secondary { color: #f7f2ff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16); }
      .venue-deal-form-actions .danger { color: #ffccd3; background: rgba(255,86,108,.12); border: 1px solid rgba(255,86,108,.3); }
      .venue-deal-feedback { grid-column: 1 / -1; margin: 0; padding: 11px 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; color: #f8fafc !important; background: rgba(255,255,255,.06); font-size: 13px; font-weight: 850; line-height: 1.45; }
      .venue-deal-publish-status { display: grid; gap: 12px; padding: 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: rgba(255,255,255,.035); }
      .venue-deal-publish-status.live { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.07); box-shadow: inset 3px 0 0 rgba(50,255,164,.7); }
      .venue-deal-publish-status-heading { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; }
      .venue-deal-publish-status-heading > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: #d8cfeb; background: rgba(255,255,255,.08); font-weight: 950; }
      .venue-deal-publish-status.live .venue-deal-publish-status-heading > span { color: #061015; background: #78ffc0; }
      .venue-deal-publish-status-heading > div { display: grid; gap: 3px; }
      .venue-deal-publish-status-heading strong { color: #fff; font-size: 17px; }
      .venue-deal-publish-status-heading small { color: #b9accd; line-height: 1.4; }
      .venue-deal-publish-status ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .venue-deal-publish-status li { position: relative; padding-left: 24px; color: #e8fff4; font-size: 14px; font-weight: 800; }
      .venue-deal-publish-status li::before { content: "✓"; position: absolute; left: 2px; color: #78ffc0; font-weight: 950; }
      .venue-deal-nfc-status { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:16px; padding:18px; border:1px solid var(--mydancr-dashboard-border); border-radius:14px; background:#0d0d12; }
      .venue-deal-nfc-status.is-live { border-color:rgba(16,185,129,.38); box-shadow:inset 3px 0 0 rgba(16,185,129,.7),0 0 18px rgba(16,185,129,.09); }
      .venue-deal-nfc-status>div { width:62px; height:62px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.13); border-radius:50%; color:#cbd5e1; background:#17171d; font-weight:950; letter-spacing:-6px; transform:rotate(-18deg); }
      .venue-deal-nfc-status.is-live>div { border-color:rgba(16,185,129,.46); color:#ecfdf5; background:#047857; box-shadow:0 0 20px rgba(16,185,129,.18); }
      .venue-deal-nfc-status>section { display:grid; gap:7px; }.venue-deal-nfc-status h3,.venue-deal-nfc-status p{margin:0}.venue-deal-nfc-status p{color:#cbd5e1;line-height:1.48}.venue-deal-nfc-status small{color:#b9accd;line-height:1.4}
      .venue-deal-qr-generator { display: grid; grid-template-columns: 1fr; gap: 18px; align-items: center; padding: 18px; border: 1px solid rgba(124,58,237,.46); border-radius: 14px; background: radial-gradient(circle at 100% 0%, rgba(124,58,237,.16), transparent 22rem), #0a0910; box-shadow: inset 0 1px 0 rgba(248,250,252,.04); }
      .venue-deal-qr-generator.has-qr { grid-template-columns: minmax(0, 1fr) minmax(190px, 250px); }
      .venue-deal-qr-copy { display: grid; gap: 9px; }
      .venue-deal-qr-copy h3, .venue-deal-qr-copy p { margin: 0; }
      .venue-deal-qr-copy p { color: #cbd5e1; line-height: 1.48; }
      .venue-deal-qr-copy small { color: #fbbf24; font-weight: 800; }
      .venue-deal-qr-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 5px; }
      .venue-deal-qr-actions button { min-height: 42px; background: #7c3aed; color: #f8fafc; border: 1px solid rgba(196,181,253,.44); box-shadow: 0 0 18px rgba(124,58,237,.18); }
      .venue-deal-share-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px; border: 1px solid rgba(196,181,253,.24); border-radius: 10px; background: rgba(124,58,237,.08); }
      .venue-deal-share-options button { min-height: 44px; padding: 8px 10px; color: #f8fafc; background: #111118; border: 1px solid #334155; font-size: 12px; }
      .venue-deal-qr-preview { min-height: 210px; display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px; box-sizing: border-box; border: 1px solid #334155; border-radius: 12px; background: #050507; text-align: center; }
      .venue-deal-qr-preview img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; background: #fff; }
      .venue-deal-qr-preview strong { color: #f8fafc; font-size: 13px; }
      .venue-deal-qr-preview small { color: #10b981; font-size: 11px; font-weight: 850; }
      .venue-deal-qr-loading { min-height: 210px; display: grid; place-items: center; border: 1px solid #334155; border-radius: 12px; color: #cbd5e1; background: #050507; font-weight: 850; text-align: center; }
      .venue-deal-how { overflow: hidden; border: 1px solid rgba(148,229,255,.2); border-radius: 10px; background: rgba(148,229,255,.035); }
      .venue-deal-how > summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; color: #f7f2ff; font-weight: 950; cursor: pointer; list-style: none; }
      .venue-deal-how > summary::-webkit-details-marker { display: none; }
      .venue-deal-how > summary:focus-visible { outline: 2px solid #94e5ff; outline-offset: -3px; }
      .venue-deal-how > summary::after { content: "+"; color: #94e5ff; font-size: 22px; line-height: 1; }
      .venue-deal-how[open] > summary::after { content: "−"; }
      .venue-deal-how > div { display: grid; gap: 14px; padding: 0 14px 14px; }
      .venue-deal-how > div > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .currency-input { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; border: 1px solid rgba(50,255,164,.28); border-radius: 8px; background: rgba(50,255,164,.06); overflow: hidden; }
      .currency-input > span { padding-left: 12px; color: #78ffc0; font-weight: 950; }
      .currency-input input { border: 0; background: transparent; }
      .commission-tier-table { display: grid; border: 1px solid rgba(50,255,164,.2); border-radius: 10px; overflow: hidden; }
      .commission-tier-table > strong { padding: 12px; color: #78ffc0; background: rgba(50,255,164,.08); }
      .commission-tier-table > div { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 16px; padding: 11px 12px; border-top: 1px solid rgba(255,255,255,.08); }
      .commission-tier-table b { color: #fff; font-size: 13px; }
      .venue-deal-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .venue-redemption-instructions { display: grid; gap: 6px; padding: 14px; border: 1px solid rgba(148,229,255,.22); border-radius: 10px; background: rgba(148,229,255,.06); }
      .venue-redemption-instructions strong { color: #94e5ff; }
      .deal-panel { grid-column: span 2; }
      .deal-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 !important; overflow: hidden; border: 1px solid var(--mydancr-dashboard-border); border-radius: 14px; background: var(--mydancr-dashboard-panel-raised); }
      .deal-metrics .metric { min-height: 66px; padding: 12px 14px; border-top: 0; border-left: 1px solid var(--mydancr-dashboard-border); }
      .deal-metrics .metric:first-child { border-left: 0; }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid var(--mydancr-dashboard-border); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      .venue-verification-panel { display: grid; gap: 14px; border-color: rgba(34,211,238,.24); background: radial-gradient(circle at 100% 0%, rgba(34,211,238,.09), transparent 26rem), rgba(12,12,18,.88); }
      .venue-verification-panel > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .venue-verification-actions { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(150px, .7fr); gap: 10px; }
      .venue-verification-scan-button, .venue-verification-manual-toggle, .venue-verification-scanner button, .venue-verification-manual button { min-height: 48px; border: 1px solid var(--dancr-color-brand-primary-strong); border-radius: 8px; color: var(--dancr-color-text-primary); background: linear-gradient(135deg, var(--dancr-color-brand-primary), var(--dancr-color-brand-primary-deep)); padding: 0 16px; font: inherit; font-weight: 950; cursor: pointer; box-shadow: var(--dancr-shadow-brand-control); }
      .venue-verification-scan-button { display: flex; align-items: center; justify-content: center; gap: 12px; text-align: left; }
      .venue-verification-scan-button svg { width: 28px; height: 28px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .venue-verification-scan-button > span { display: grid; gap: 2px; }
      .venue-verification-scan-button strong { color: var(--dancr-color-text-primary); }
      .venue-verification-scan-button small { color: var(--dancr-color-brand-core); font-size: 11px; font-weight: 800; }
      .venue-verification-manual-toggle, .venue-verification-scanner button { border-color: var(--dancr-color-border-subtle); color: var(--dancr-color-text-secondary); background: var(--dancr-color-surface-soft); box-shadow: none; }
      .venue-verification-scan-button:disabled, .venue-verification-manual-toggle:disabled, .venue-verification-scanner button:disabled, .venue-verification-manual button:disabled { opacity: .55; cursor: wait; }
      .venue-verification-scan-button:focus-visible, .venue-verification-manual-toggle:focus-visible, .venue-verification-scanner button:focus-visible, .venue-verification-manual button:focus-visible, .venue-verification-manual input:focus-visible { outline: 2px solid var(--dancr-color-brand-core); outline-offset: 2px; }
      .venue-verification-scanner { display: grid; grid-template-columns: minmax(180px, 320px) minmax(0, 1fr); align-items: center; gap: 16px; padding: 14px; border: 1px solid var(--dancr-color-brand-primary-medium); border-radius: 12px; background: var(--dancr-color-background); }
      .venue-verification-video-wrap { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid var(--dancr-color-white-medium); border-radius: 8px; background: var(--dancr-color-background); }
      .venue-verification-video-wrap video { width: 100%; height: 100%; display: block; object-fit: cover; }
      .venue-verification-video-wrap > span { position: absolute; inset: 13%; border: 2px solid var(--dancr-color-brand-core); border-radius: 8px; box-shadow: 0 0 0 999px var(--dancr-color-black-medium), var(--dancr-shadow-beam-active); pointer-events: none; }
      .venue-verification-scanner > div:last-child { display: grid; gap: 9px; }
      .venue-verification-scanner strong { color: var(--dancr-color-text-primary); font-size: 18px; }
      .venue-verification-scanner small { color: var(--dancr-color-text-secondary); line-height: 1.45; }
      .venue-verification-manual { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--dancr-color-border-subtle); border-radius: 10px; background: var(--dancr-color-surface-soft); }
      .venue-verification-manual label { color: var(--dancr-color-text-secondary); font-size: 13px; font-weight: 900; }
      .venue-verification-manual > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
      .venue-verification-manual input { min-height: 48px; min-width: 0; border: 1px solid var(--dancr-color-border); border-radius: 8px; color: var(--dancr-color-text-primary); background: var(--dancr-color-surface); padding: 0 12px; font: inherit; }
      .venue-verification-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; }
      .venue-verification-controls label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-verification-controls select { min-height: 46px; width: 100%; border: 1px solid rgba(34,211,238,.28); border-radius: 8px; color: #fff; background: #11111a; padding: 0 12px; font: inherit; }
      .venue-verification-controls button, .dancer-verification-qr button, .venue-verification-preview button, .verified-affiliation-list button { min-height: 44px; border: 1px solid rgba(34,211,238,.38); border-radius: 8px; color: #061015; background: linear-gradient(135deg, #67e8f9, #c084fc); padding: 0 16px; font: inherit; font-weight: 950; cursor: pointer; }
      .venue-verification-controls button:disabled, .venue-verification-preview button:disabled, .verified-affiliation-list button:disabled { opacity: .55; cursor: wait; }
      .dancer-verification-qr { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 18px; align-items: center; padding: 16px; border: 1px solid rgba(34,211,238,.3); border-radius: 12px; background: rgba(4,8,14,.8); }
      .dancer-verification-qr > img { display: block; width: 100%; aspect-ratio: 1; border-radius: 8px; background: #fff; }
      .dancer-verification-qr > div, .venue-verification-preview > div { display: grid; gap: 8px; }
      .dancer-verification-qr strong, .venue-verification-preview strong { color: #fff; font-size: 20px; }
      .dancer-verification-qr span, .venue-verification-preview span { color: #94e5ff; font-weight: 850; }
      .dancer-verification-qr small, .venue-verification-preview small, .verified-affiliation-list small { color: #b9accd; line-height: 1.4; }
      .verified-affiliation-list { display: grid; gap: 9px; }
      .verified-affiliation-list > strong { color: #fff; }
      .verified-affiliation-list > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(255,255,255,.035); }
      .verified-affiliation-list > div > span { display: grid; gap: 3px; min-width: 0; }
      .verified-affiliation-list b { color: #78ffc0; overflow-wrap: anywhere; }
      .verified-affiliation-list button { min-height: 36px; color: #fff; background: rgba(255,255,255,.06); }
      .venue-verification-preview { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 16px; border: 1px solid rgba(50,255,164,.3); border-radius: 12px; background: rgba(50,255,164,.055); }
      .venue-verification-avatar { width: 68px; height: 68px; display: grid; place-items: center; overflow: hidden; border: 2px solid #f8fbff; border-radius: 50%; color: #fff; background: #171722; font-size: 24px; font-weight: 950; }
      .venue-verification-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .dashboard-shell-dancer { --mydancr-dashboard-panel: #09090d; --mydancr-dashboard-panel-raised: #111116; --mydancr-dashboard-border: rgba(255,255,255,.105); --mydancr-dashboard-muted: rgba(218,218,226,.68); color-scheme: dark; background: radial-gradient(circle at 14% 2%, rgba(110,54,220,.08), transparent 22rem), #050507; }
      .dashboard-shell-dancer .dashboard-head { min-height: 0; padding: 20px 22px; border-color: var(--mydancr-dashboard-border); border-radius: 22px; background: #07070a; box-shadow: 0 20px 48px rgba(0,0,0,.34); }
      .dashboard-shell-dancer .dashboard-head h1 { overflow: visible; font-size: clamp(29px,5vw,42px); text-overflow: clip; white-space: normal; }
      .dancer-onboarding-command { grid-column: 1 / -1; display: grid; gap: 18px; padding: clamp(16px,3vw,24px); border: 1px solid var(--mydancr-dashboard-border); border-radius: 20px; background: linear-gradient(145deg, #111116, #09090d 72%); box-shadow: 0 22px 54px rgba(0,0,0,.32); scroll-margin-top: 18px; }
      .dancer-profile-media-preview { grid-column: 1 / -1; min-width: 0; display: grid; grid-template-columns: 46px minmax(0,1fr) auto; align-items: center; gap: 13px; padding: 14px 15px; border: 1px solid rgba(126,234,255,.24); border-radius: 18px; background: radial-gradient(circle at 0 50%,rgba(34,199,255,.09),transparent 18rem),linear-gradient(135deg,rgba(21,13,39,.96),rgba(8,9,14,.98)); box-shadow: inset 3px 0 0 rgba(139,92,246,.82),0 16px 36px rgba(0,0,0,.25); }
      .dancer-profile-media-preview-icon { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid rgba(126,234,255,.28); border-radius: 50%; color: #8fe9fa; background: linear-gradient(145deg,rgba(124,58,237,.28),rgba(34,199,255,.1)); }
      .dancer-profile-media-preview-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-media-preview-copy { min-width: 0; display: grid; gap: 3px; }
      .dancer-profile-media-preview-copy .eyebrow { color: #8fe9fa; }
      .dancer-profile-media-preview-copy strong { color: #fff; font-size: 17px; line-height: 1.15; }
      .dancer-profile-media-preview-copy small { max-width: 58ch; color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.4; }
      .dancer-profile-media-preview-button { min-width: 132px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(126,234,255,.42); border-radius: 999px; color: #fff; background: linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow: 0 10px 24px rgba(61,27,143,.28),inset 0 1px 0 rgba(255,255,255,.14); font: inherit; font-size: 11px; font-weight: 950; cursor: pointer; white-space: nowrap; }
      .dancer-profile-media-preview-button:hover { border-color: rgba(126,234,255,.7); filter: brightness(1.08); }
      .dancer-profile-media-preview-button:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .dancer-profile-editor-launch-card { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; padding:0; border:0; background:transparent; box-shadow:none; }
      .dancer-profile-editor-launch-card > span { min-width:0; display:grid; gap:5px; }
      .dancer-profile-editor-launch-card > span > strong { color:#fff; font-size:18px; line-height:1.15; }
      .dancer-profile-editor-launch-card > span > small { max-width:56ch; color:#c4bfcc; font-size:12px; line-height:1.45; }
      .dancer-profile-editor-launch-button { min-width:170px; min-height:46px; padding:0 16px; border:1px solid rgba(126,234,255,.42); border-radius:999px; color:#fff; background:linear-gradient(135deg,#6d28d9,#0b94c9); box-shadow:0 10px 24px rgba(61,27,143,.28); font:inherit; font-size:12px; font-weight:950; cursor:pointer; }
      .dancer-onboarding-command-head { display: grid; gap: 14px; }
      .dancer-onboarding-command-head > span { display: grid; gap: 7px; }
      .dancer-onboarding-command-head .eyebrow { color: #bda5ed; font-size: 10px; letter-spacing: .14em; }
      .dancer-onboarding-command-head h2 { color: #f8f7fb; font-size: clamp(25px,4vw,34px); letter-spacing: -.025em; }
      .dancer-onboarding-command-head p { margin: 0; color: #c4bfce; font-size: 14px; line-height: 1.45; }
      .dancer-onboarding-progress { display: flex; align-items: center; gap: 12px; }
      .dancer-onboarding-progress-track { flex: 1; display: flex; gap: 5px; }
      .dancer-onboarding-progress-track > span { flex: 1; height: 4px; border-radius: 999px; background: #35303e; }
      .dancer-onboarding-progress-track > .is-complete { background: #70efbd; }
      .dancer-onboarding-progress > b { color: #d7d0e2; font-size: 11px; font-weight: 650; white-space: nowrap; }
      .dancer-onboarding-steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .dancer-onboarding-steps > li { min-width: 0; overflow: clip; border: 1px solid rgba(255,255,255,.09); border-radius: 15px; background: #0d0d12; scroll-margin-top: 18px; }
      .dancer-onboarding-steps > li > button { width: 100%; min-height: 58px; display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 9px 10px; border: 0; border-radius: 14px; color: #f8f7fb; background: #0d0d12; font: inherit; text-align: left; cursor: pointer; }
      .dancer-onboarding-step-marker { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.17); border-radius: 50%; color: #d7d5dd; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; }
      .dancer-onboarding-step-copy { min-width: 0; display: grid; gap: 3px; }
      .dancer-onboarding-step-title { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
      .dancer-onboarding-step-copy strong { color: #f8f7fb; font-size: 15px; font-weight: 750; line-height: 1.3; }
      .dancer-onboarding-step-copy small { color: #c4bfce; font-size: 12px; font-weight: 450; line-height: 1.4; }
      .dancer-onboarding-step-title em { padding: 2px 6px; border: 1px solid #494251; border-radius: 999px; color: #cfc6dd; background: #211c2b; font-size: 8px; font-style: normal; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
      .dancer-onboarding-step-control { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px; border: 1px solid rgba(139,92,246,.38); border-radius: 999px; color: #f7f1ff; background: rgba(109,40,217,.18); font-size: 10px; font-weight: 950; white-space: nowrap; }
      .dancer-onboarding-step-control-chevron, .dancer-onboarding-step-control-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-onboarding-step-control-chevron { transition: transform .18s ease; }
      .dancer-onboarding-step-control-chevron.is-open { transform: rotate(90deg); }
      .dancer-onboarding-step-control.is-locked { width: 36px; padding: 0; border-color: transparent; color: #aaa4b6; background: transparent; }
      .dancer-onboarding-step-control.is-complete { border-color: rgba(76,223,166,.3); color: #70efbd; background: rgba(25,140,101,.1); }
      .dancer-onboarding-steps .is-current .dancer-onboarding-step-control.is-action { border-color: #9864ed; background: #6d28d9; color: #fff; }
      .dancer-onboarding-steps .is-current .dancer-onboarding-step-marker { border-color: #9864ed; background: #6d28d9; color: #fff; }
      .dancer-onboarding-step-check { font-size: 12px; line-height: 1; }
      .dancer-onboarding-steps .is-current > button { background: rgba(97,45,188,.12); box-shadow: inset 3px 0 0 #8b5cf6; }
      .dancer-onboarding-steps .is-current { border-color: rgba(139,92,246,.56); }
      .dancer-onboarding-steps .is-complete { border-color: rgba(76,223,166,.28); }
      .dancer-onboarding-steps .is-complete > button { background: rgba(25,140,101,.07); }
      .dancer-onboarding-steps .is-complete .dancer-onboarding-step-marker { border-color: rgba(76,223,166,.42); color: #70efbd; background: rgba(25,140,101,.13); }
      .dancer-onboarding-steps > .is-locked { border-color: rgba(211,196,238,.14); background: #111116; }
      .dancer-onboarding-steps .is-locked > button { background: #111116; box-shadow: none; cursor: not-allowed; }
      .dancer-onboarding-steps .is-locked > button:disabled { opacity: 1 !important; filter: none !important; }
      .dancer-onboarding-steps .is-locked .dancer-onboarding-step-marker { border-color: #383440; color: #aaa4b6; background: #19181f; }
      .dancer-onboarding-steps .is-locked .dancer-onboarding-step-copy strong { color: #dedbe5; }
      .dancer-onboarding-steps .is-locked .dancer-onboarding-step-copy small { color: #bcb6c8; }
      body.dancr-button-system .dancer-onboarding-steps > li > button { padding: 13px 12px; border: 0 !important; border-radius: 14px !important; background: #141119 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
      body.dancr-button-system .dancer-onboarding-steps > .is-current > button { background: linear-gradient(110deg,#26173c,#18111f) !important; }
      body.dancr-button-system .dancer-onboarding-steps > .is-complete > button { background: #101d19 !important; }
      body.dancr-button-system .dancer-onboarding-steps > .is-locked > button { background: #111116 !important; }
      body.dancr-button-system .dancer-onboarding-steps > .is-open > button { border-radius: 14px 14px 0 0 !important; }
      .dancer-onboarding-steps .is-deferred { border-color: rgba(126,234,255,.14); }
      .dancer-onboarding-steps .is-open > button { border-radius: 14px 14px 0 0; }
      .dancer-onboarding-step-panel { display: grid; gap: 14px; padding: 14px; border-top: 1px solid rgba(255,255,255,.09); background: #09090d; animation: dancer-onboarding-panel-in .18s ease-out; }
      .dancer-onboarding-step-panel[hidden] { display: none; }
      .dancer-onboarding-step-panel:has(.dancer-profile-preview-overlay) { animation:none; }
      .dancer-onboarding-step-panel .dancer-onboarding-profile-workspace { margin: 0; }
      .dancer-step-one-workspace { min-width: 0; display: grid; gap: 12px; }
      .dancer-step-one-summary { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: start; gap: 12px; padding: 14px; border: 1px solid rgba(126,234,255,.17); border-radius: 14px; background: linear-gradient(145deg,rgba(17,17,24,.96),rgba(7,7,11,.98)); }
      .dancer-step-one-summary > span { min-width: 0; display: grid; gap: 5px; }
      .dancer-step-one-summary h3 { color: #fff; font-size: clamp(20px,4vw,26px); }
      .dancer-step-one-summary p { color: var(--mydancr-dashboard-muted); font-size: 12px; line-height: 1.45; }
      .dancer-step-one-summary > b { padding: 6px 9px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #d8d5df; background: rgba(255,255,255,.04); font-size: 10px; white-space: nowrap; }
      .dancer-step-one-checklist { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; }
      .dancer-step-one-checklist button { min-width: 0; min-height: 54px; display: grid; grid-template-columns: 22px minmax(0,1fr); align-items: center; gap: 2px 7px; padding: 8px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; color: #f7f5fa; background: rgba(255,255,255,.035); font: inherit; text-align: left; cursor: pointer; }
      .dancer-step-one-checklist button > span { width: 20px; height: 20px; grid-row: 1 / span 2; display: grid; place-items: center; border-radius: 50%; color: #aaa5b1; background: rgba(255,255,255,.07); font-size: 11px; font-weight: 950; }
      .dancer-step-one-checklist button strong { min-width: 0; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-step-one-checklist button small { color: #aaa5b1; font-size: 8px; font-weight: 900; letter-spacing: .03em; text-transform: uppercase; }
      .dancer-step-one-checklist button.is-complete { border-color: rgba(76,223,166,.25); background: rgba(25,140,101,.07); }
      .dancer-step-one-checklist button.is-complete > span { color: #70efbd; background: rgba(25,140,101,.17); }
      .dancer-step-one-checklist button.is-complete small { color: #70efbd; }
      .dancer-step-one-checklist button.is-checking { border-color: rgba(126,234,255,.23); }
      .dancer-step-one-checklist button.is-checking small { color: #8fe9fa; }
      .dancer-step-one-checklist button.is-replace, .dancer-step-one-checklist button.is-unsaved { border-color: rgba(235,187,91,.25); }
      .dancer-step-one-checklist button.is-replace small, .dancer-step-one-checklist button.is-unsaved small { color: #f2ce83; }
      .dancer-step-one-sections { display: grid; gap: 7px; }
      .dancer-step-one-section { min-width: 0; overflow: clip; border: 1px solid rgba(255,255,255,.09); border-radius: 13px; background: #0c0c11; }
      .dancer-step-one-section.is-complete { border-color: rgba(76,223,166,.23); }
      .dancer-step-one-section.is-checking { border-color: rgba(126,234,255,.23); }
      .dancer-step-one-section.is-replace, .dancer-step-one-section.is-unsaved { border-color: rgba(235,187,91,.28); }
      .dancer-step-one-section-button { width: 100%; min-height: 66px; display: grid; grid-template-columns: 30px minmax(0,1fr) auto 26px; align-items: center; gap: 9px; padding: 10px 11px; border: 0; color: #f8f7fb; background: #0c0c11; font: inherit; text-align: left; cursor: pointer; }
      .dancer-step-one-section-marker { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; color: #ccc8d2; background: rgba(255,255,255,.045); font-size: 11px; font-weight: 950; }
      .dancer-step-one-section-button > span:nth-child(2) { min-width: 0; display: grid; gap: 3px; }
      .dancer-step-one-section-button strong { font-size: 14px; }
      .dancer-step-one-section-button small { overflow: hidden; color: var(--mydancr-dashboard-muted); font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-step-one-section-button em { padding: 5px 7px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; color: #bcb8c3; background: rgba(255,255,255,.035); font-size: 8px; font-style: normal; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
      .dancer-step-one-section-button i { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; color: #f5efff; background: #301b46; font-size: 18px; font-style: normal; line-height: 1; }
      .dancer-step-one-section.is-complete .dancer-step-one-section-marker, .dancer-step-one-section.is-complete .dancer-step-one-section-button em { border-color: rgba(76,223,166,.28); color: #70efbd; background: rgba(25,140,101,.1); }
      .dancer-step-one-section.is-checking .dancer-step-one-section-button em { color: #8fe9fa; }
      .dancer-step-one-section.is-replace .dancer-step-one-section-button em, .dancer-step-one-section.is-unsaved .dancer-step-one-section-button em { color: #f2ce83; }
      .dancer-step-one-section-panel { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 10px; padding: 10px; border-top: 1px solid rgba(255,255,255,.08); background: #08080c; animation: dancer-onboarding-panel-in .18s ease-out; }
      .dancer-step-one-section-panel[hidden] { display: none; }
      .dancer-step-one-section-panel > .info-panel { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; grid-column: 1 / -1; padding: 12px; border: 0; border-radius: 10px; background: #0d0d12; }
      .dancer-step-one-section-panel > .setup-panel > h2, .dancer-step-one-section-panel > .upload-panel > h2, .dancer-step-one-section-panel > .dancer-avatar-panel > .eyebrow, .dancer-step-one-section-panel > .dancer-avatar-panel > h2 { display: none; }
      .dancer-step-one-optional-panel { grid-template-columns: 1fr; }
      .dancer-step-one-optional-panel > * { min-width: 0; }
      .dancer-step-one-section-panel form, .dancer-step-one-section-panel label, .dancer-step-one-section-panel form > *, .dancer-step-one-section-panel .photo-review-list, .dancer-step-one-section-panel .photo-review-card, .dancer-step-one-section-panel .dancer-avatar-editor { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .dancer-step-one-section-panel input:not([type="checkbox"]):not([type="radio"]), .dancer-step-one-section-panel select, .dancer-step-one-section-panel textarea { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .dancer-step-one-section-panel input[type="file"] { overflow: hidden; font-size: 12px; }
      .dancer-step-one-section-panel p, .dancer-step-one-section-panel small, .dancer-step-one-section-panel em, .dancer-step-one-section-panel strong { max-width: 100%; overflow-wrap: anywhere; }
      .dancer-step-one-optional-panel .socials-panel { gap: 10px; }
      .dancer-step-one-optional-panel .socials-panel form { gap: 9px; }
      .dancer-step-one-optional-panel .socials-panel label { gap: 5px; }
      .dancer-step-one-optional-panel .socials-panel input { height: 46px; min-height: 46px; max-height: 46px; padding: 0 11px; }
      .dancer-step-one-optional-panel .socials-panel button[type="submit"] { min-height: 46px; }
      .dancer-profile-form-actions { display: flex; align-items: center; gap: 8px; }
      .dancer-profile-form-actions button { min-height: 44px !important; padding: 0 14px !important; border-radius: 999px !important; font-size: 11px !important; white-space: nowrap; }
      .dancer-profile-form-actions .dancer-profile-save-action { flex: 1 1 auto; }
      .dancer-profile-form-actions .dancer-profile-reload-action { flex: 0 1 auto; border-color: rgba(126,234,255,.2) !important; color: #d5f8ff !important; background: rgba(126,234,255,.07) !important; box-shadow: none !important; }
      .dancer-profile-form-actions .dancer-profile-reload-action:hover { border-color: rgba(126,234,255,.48) !important; background: rgba(126,234,255,.13) !important; }
      .dancer-form-save-state { grid-column: 1 / -1; min-height: 18px; margin: 0; color: #70efbd !important; font-size: 11px !important; }
      .dancer-form-save-state.is-unsaved { color: #f2ce83 !important; }
      .dancer-step-one-footer { display: grid; grid-template-columns: minmax(0,1fr) minmax(180px,240px); align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 13px; background: #0c0c11; }
      .dancer-step-one-footer > span { display: grid; gap: 3px; }
      .dancer-step-one-footer strong { color: #fff; font-size: 13px; }
      .dancer-step-one-footer small { color: var(--mydancr-dashboard-muted); font-size: 10px; }
      .dancer-step-one-footer.is-ready { border-color: rgba(76,223,166,.3); background: rgba(25,140,101,.07); }
      .dancer-onboarding-preview-workspace { display: grid; gap: 12px; }
      .dancer-onboarding-profile-review { margin-top: 0; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.09); scroll-margin-top: calc(var(--mydancr-preview-banner-offset, 0px) + 14px); }
      .dancer-profile-agreement-review { display:grid; gap:12px; }
      .dancer-profile-agreement-review h3, .dancer-profile-agreement-review p { margin:0; }
      .dancer-profile-agreement-review p { color:#c4bfcc; font-size:13px; line-height:1.5; }
      .dancer-profile-agreement-review form { display:grid; gap:16px; }
      .dancer-profile-agreement-check { display:flex; align-items:flex-start; gap:12px; color:#eee9f5; font-size:14px; line-height:1.6; }
      .dancer-profile-agreement-check input { width:22px; height:22px; min-height:22px; flex:0 0 22px; margin:2px 0 0; accent-color:#8b5cf6; }
      .dancer-profile-agreement-check a { color:#d3baff; text-decoration:underline; text-underline-offset:3px; }
      .dancer-profile-agreement-review .dancer-onboarding-primary { width:100%; min-height:48px; }
      .dancer-onboarding-review-identity { display:flex; align-items:center; gap:12px; }
      .dancer-onboarding-review-identity > img { width:64px; height:64px; border-radius:50%; object-fit:cover; }
      .dancer-onboarding-review-identity > span { display:grid; gap:4px; }
      .dancer-onboarding-review-identity small { color:#c4bfcc; }
      .dancer-onboarding-review-photos { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .dancer-onboarding-review-photos img { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:10px; }
      .dancer-onboarding-profile-review > .dancer-onboarding-announcement { min-height:0; margin:0; color:#c4bfcc; font-size:12px; font-weight:500; line-height:1.45; }
      .dancer-onboarding-profile-review > .dancer-onboarding-announcement:empty { display:none; }
      body.dancr-button-system .dancer-profile-editor-launch-card .dancer-profile-editor-launch-button { min-height:48px !important; padding:10px 14px; border-radius:12px !important; border-color:rgba(196,181,253,.3) !important; color:#fff !important; background:#19161f !important; box-shadow:none !important; font-size:14px; line-height:1.25; }
      body.dancr-button-system .dancer-profile-editor-launch-card[data-ready="false"] .dancer-profile-editor-launch-button,
      body.dancr-button-system .dancer-onboarding-profile-review > .dancer-onboarding-primary:not(:disabled) { border-color:#9b68f6 !important; color:#fff !important; background:#7c3aed !important; box-shadow:none !important; }
      body.dancr-button-system .dancer-onboarding-profile-review > .dancer-onboarding-primary { min-height:48px !important; padding:10px 14px; border-radius:12px !important; font-size:14px; line-height:1.25; }
      body.dancr-button-system .dancer-onboarding-profile-review > .dancer-onboarding-primary:disabled { border-color:rgba(196,181,253,.12) !important; color:#96929f !important; background:#141219 !important; box-shadow:none !important; opacity:1 !important; cursor:not-allowed; }
      body.dancr-button-system .dancer-onboarding-profile-review > .dancer-onboarding-primary:disabled[aria-busy="true"] { cursor:wait; }
      .dancer-onboarding-complete-note { display: grid; gap: 4px; padding: 13px; border: 1px solid rgba(76,223,166,.28); border-radius: 12px; color: #70efbd; background: rgba(25,140,101,.09); }
      .dancer-onboarding-complete-note span { color: var(--mydancr-dashboard-muted); font-size: 11px; line-height: 1.4; }
      .dancer-activation-confirmation { grid-column: 1 / -1; position: relative; display: grid; grid-template-columns: 52px minmax(0,1fr) 42px; align-items: start; gap: 14px; padding: 18px; border: 1px solid rgba(96,255,188,.28); border-radius: var(--mydancr-dashboard-radius); background: radial-gradient(circle at 0 0,rgba(42,205,137,.14),transparent 25rem),#0a0d0c; box-shadow: 0 18px 42px rgba(0,0,0,.32); }
      .dancer-activation-check { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; color: #06110d; background: #7dffc7; font-size: 24px; font-weight: 950; }
      .dancer-activation-copy { min-width: 0; display: grid; gap: 7px; }
      .dancer-activation-copy .eyebrow { color: #8dffd0; }
      .dancer-activation-copy h2 { color: #fff; font-size: clamp(22px,5vw,30px); }
      .dancer-activation-copy p { max-width: 60ch; color: rgba(236,242,239,.76); font-size: 14px; line-height: 1.45; }
      .dancer-activation-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 4px; }
      .dancer-activation-actions a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: rgba(255,255,255,.06); font-size: 12px; font-weight: 900; text-decoration: none; }
      .dancer-activation-actions a:first-child { border-color: rgba(96,255,188,.36); color: #07110d; background: #8dffd0; }
      .dancer-activation-confirmation > button { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; color: rgba(255,255,255,.76); background: rgba(255,255,255,.055); cursor: pointer; }
      .dancer-activation-confirmation > button svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      @keyframes dancer-onboarding-panel-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      .dancer-avatar-preview { overflow: hidden; display: grid; place-items: center; border: 2px solid #f8fbff; border-radius: 50%; color: #fff; background: #17171d; font-weight: 950; }
      .dancer-avatar-preview img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
      .dancer-onboarding-preview-open { width: 100%; min-height: 46px; border: 1px solid rgba(126,234,255,.34); border-radius: 12px; color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.8), rgba(11,148,201,.58)); font: inherit; font-size: 13px; font-weight: 950; cursor: pointer; }
      .dancer-onboarding-preview-open:disabled { opacity: .48; cursor: not-allowed; }
      .dancer-profile-preview-overlay { position: fixed; z-index: 1498; inset: var(--mydancr-preview-banner-offset,0px) 0 0; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; overscroll-behavior-x: none; overscroll-behavior-y: contain; color: #f7f2ff; background: #050507; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.28) transparent; }
      .dancer-profile-preview-overlay *, .dancer-profile-preview-overlay *::before, .dancer-profile-preview-overlay *::after { box-sizing:border-box; }
      .dancer-profile-preview-overlay::-webkit-scrollbar { width: 4px; }
      .dancer-profile-preview-overlay::-webkit-scrollbar-track { background: transparent; }
      .dancer-profile-preview-overlay::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(255,255,255,.28); }
      .dancer-profile-preview-shell { width: 100%; max-width: 100%; min-width: 0; min-height: 100dvh; box-sizing: border-box; overflow-x: hidden; padding: 0 clamp(18px,4vw,56px) max(130px,calc(env(safe-area-inset-bottom) + 110px)); background: radial-gradient(circle at 78% 8%,rgba(139,92,246,.22),transparent 28rem),linear-gradient(180deg,#090911,#050507 62%); }
      .dancer-profile-preview-overlay .profile-titlebar { position: sticky; z-index: 10; top: 0; width: min(100%,760px); max-width: 100%; min-width: 0; min-height: 64px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; margin: 0 auto; padding: max(8px,env(safe-area-inset-top)) 52px 8px 0; background: radial-gradient(circle at 14% 0%,rgba(126,234,255,.055),transparent 11rem),linear-gradient(180deg,rgba(5,5,8,.98),rgba(5,5,8,.92)); box-shadow: 0 8px 24px rgba(0,0,0,.2); backdrop-filter: blur(22px); }
      .dancer-profile-preview-overlay .profile-titlebar-avatar { position: relative; width: 42px; height: 42px; display: grid; flex: 0 0 42px; place-items: center; overflow: hidden; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg,rgba(124,58,237,.72),rgba(34,199,255,.35)); box-shadow: 0 10px 26px rgba(0,0,0,.36),0 0 18px rgba(124,58,237,.15); font-size: 13px; font-weight: 950; }
      .dancer-profile-preview-overlay .profile-titlebar-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; background: radial-gradient(circle at 68% 20%, rgba(126,234,255,.16), transparent 34%), linear-gradient(145deg, rgba(109,40,217,.38), #08080d); filter: brightness(1.14) contrast(1.03); }
      .dancer-profile-preview-overlay .profile-titlebar-identity { min-width: 0; display: grid; flex: 1 1 auto; gap: 6px; }
      .dancer-profile-preview-overlay .profile-titlebar-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
      .dancer-profile-preview-overlay .profile-titlebar h1 { margin: 0; overflow: hidden; font-size: clamp(20px,4vw,26px); line-height: 1.05; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-titlebar-context { max-width: 100%; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; overflow: hidden; }
      .dancer-profile-preview-overlay .profile-titlebar-city { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid rgba(180,169,196,.14); border-radius: 999px; color: #c8bfd6; background: rgba(255,255,255,.035); font-size: 9px; font-weight: 850; white-space: nowrap; }
      .dancer-profile-preview-overlay .public-profile-close { position: absolute; top: max(8px,env(safe-area-inset-top)); right: 0; width: 40px; min-width: 40px; max-width: 40px; height: 40px; min-height: 40px; max-height: 40px; display: inline-grid; grid-template: 1fr / 1fr; gap: 0; flex: 0 0 40px; place-items: center; padding: 0; border: 1px solid rgba(180,169,196,.2); border-radius: 50% !important; color: #fff; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.04),0 10px 24px rgba(0,0,0,.28); font-size: 0; line-height: 0; cursor: pointer; }
      .dancer-profile-preview-overlay .public-profile-close svg { width:20px; height:20px; display:block; overflow:visible; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; transform:none; }
      .dancer-profile-preview-overlay .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13),0 0 22px rgba(34,199,255,.18); }
      .dancer-profile-preview-overlay .profile-overview, .dancer-profile-preview-overlay .profile-social-section, .dancer-profile-preview-overlay .live-actions, .dancer-profile-preview-overlay .profile-deal-availability, .dancer-profile-preview-overlay .profile-media-section, .dancer-profile-preview-overlay .profile-schedule-section, .dancer-profile-preview-overlay .profile-tonight-card { width: min(100%,760px); max-width: 100%; min-width: 0; box-sizing: border-box; margin-inline: auto; }
      .dancer-profile-preview-overlay .profile-media-section { display: grid; gap: 12px; margin-top: 12px; }
      .dancer-profile-preview-overlay .profile-media-tabs { width: min(100%,360px); display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); justify-self: center; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.1); border-radius: 15px; background: rgba(255,255,255,.035); }
      .dancer-profile-preview-overlay .profile-media-tabs button { position: relative; min-width: 0; min-height: 46px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid transparent; border-radius: 11px; color: #a59aae; background: transparent; box-shadow: none; cursor: pointer; }
      .dancer-profile-preview-overlay .profile-media-tabs button::before { content: none; }
      body.dancr-button-system .dancer-profile-preview-overlay .profile-media-tabs button { border: 1px solid transparent !important; border-radius: 11px !important; color: #a59aae !important; background: transparent !important; box-shadow: none !important; }
      body.dancr-button-system .dancer-profile-preview-overlay .profile-media-tabs button.active { border-color: rgba(126,234,255,.34) !important; color: #fff !important; background: linear-gradient(135deg,rgba(109,40,217,.72),rgba(11,148,201,.34)) !important; box-shadow: var(--dancr-shadow-beam-active) !important; }
      .dancer-profile-preview-overlay .profile-media-tab-label { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-media-tab-count { min-width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #d9d2e2; background: rgba(0,0,0,.24); font-size: 10px; font-weight: 950; line-height: 1; }
      .dancer-profile-preview-overlay .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .dancer-profile-preview-overlay .profile-media-tab-icon { width: 18px; height: 18px; display: block; flex: 0 0 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-preview-overlay .profile-media-tab-play { fill: currentColor; stroke: none; }
      .dancer-profile-preview-overlay .profile-media-grid { width: 100%; max-width: 100%; min-width: 0; min-height: 108px; box-sizing: border-box; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
      .dancer-profile-preview-overlay .profile-media-grid-item { position: relative; width: 100%; min-width: 0; aspect-ratio: 4 / 5; display: block; padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.1); border-radius: 11px; color: #fff; background: #0b0b10; box-shadow: none; cursor: pointer; }
      .dancer-profile-preview-overlay .profile-media-grid-item:is(.is-photo,.is-video)::before { position:absolute; z-index:0; inset:0; content:""; background:radial-gradient(circle at 68% 20%, rgba(126,234,255,.12), transparent 34%), radial-gradient(circle at 20% 82%, rgba(139,92,246,.2), transparent 42%), linear-gradient(145deg,#111118,#07070b); }
      .dancer-profile-preview-overlay .profile-media-grid-item img, .dancer-profile-preview-overlay .profile-media-grid-item video { position:relative; z-index:1; width: 100%; height: 100%; display: block; object-fit: cover; background:transparent; pointer-events: none; }
      .dancer-profile-preview-overlay .profile-media-grid-item img { filter: brightness(1.14) contrast(1.03); opacity:0; }
      .dancer-profile-preview-overlay .profile-media-grid-item img[data-image-state="ready"] { opacity:1; }
      .dancer-profile-preview-overlay .profile-media-grid-item img[data-image-state="error"] { visibility:hidden; }
      .dancer-profile-preview-overlay .profile-media-grid-item:focus-visible { z-index:1; outline:2px solid #7eeaff; outline-offset:2px; }
      .dancer-profile-preview-overlay .profile-media-play { position:absolute; top:50%; left:50%; width:34px; aspect-ratio:1; box-sizing:border-box; border:1px solid rgba(255,255,255,.38); border-radius:50%; background:rgba(5,5,9,.62); box-shadow:0 6px 18px rgba(0,0,0,.38); transform:translate(-50%,-50%); pointer-events:none; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
      .dancer-profile-preview-overlay .profile-media-play::after { content:""; position:absolute; top:50%; left:54%; border-top:6px solid transparent; border-bottom:6px solid transparent; border-left:9px solid #fff; transform:translate(-50%,-50%); }
      .dancer-profile-preview-overlay .profile-media-empty { grid-column:1 / -1; min-height:108px; display:grid; place-items:center; color:#8f849c; text-align:center; }
      .dancer-profile-preview-overlay .profile-media-viewer { position:fixed; z-index:2200; inset:0; width:100%; height:100vh; height:100dvh; min-height:0; display:grid; grid-template-rows:minmax(0,1fr) auto; overflow:hidden; color:#fff; background:rgba(0,0,0,.98); overscroll-behavior:none; touch-action:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-close { position:fixed; z-index:3; top: calc(16px + env(safe-area-inset-top, 0px)); right: calc(16px + env(safe-area-inset-right, 0px)); width:50px; height:50px; display:grid; place-items:center; padding:0; border:1px solid rgba(126,234,255,.42); border-radius:50%; color:#fff; background:rgba(10,10,14,.78); font-size:30px; cursor:pointer; backdrop-filter:blur(12px); }
      .dancer-profile-preview-overlay .profile-media-viewer-stage { position:relative; width:100%; height:100%; min-height:0; display:block; overflow-x:hidden; overflow-y:auto; overscroll-behavior-y:contain; scroll-snap-type:y mandatory; scroll-behavior:smooth; scrollbar-width:none; touch-action:pan-y; }
      .dancer-profile-preview-overlay .profile-media-viewer-stage::-webkit-scrollbar { display:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide { position:relative; width:100%; height:100%; min-height:100%; max-height:100%; display:grid; grid-template:minmax(0,1fr) / minmax(0,1fr); place-items:center; overflow:hidden; background:#000; scroll-snap-align:start; scroll-snap-stop:always; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide::before { position:absolute; z-index:0; inset:0; content:""; background:radial-gradient(circle at 50% 32%, rgba(126,234,255,.1), transparent 26%), linear-gradient(145deg, rgba(109,40,217,.18), #020204 68%); }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img, .dancer-profile-preview-overlay .profile-media-viewer-slide > video { position:relative; z-index:1; width:100%; height:100%; min-width:0; min-height:0; max-height:100%; display:block; object-fit:cover; background:transparent; user-select:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img { filter:brightness(1.14) contrast(1.03); opacity:0; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img[data-image-state="ready"] { opacity:1; }
      .dancer-profile-preview-overlay .profile-media-viewer-slide > img[data-image-state="error"] { visibility:hidden; }
      @media (prefers-reduced-motion:no-preference) { .dancer-profile-preview-overlay .profile-media-grid-item img, .dancer-profile-preview-overlay .profile-media-viewer-slide > img { transition:opacity 160ms ease-out; } }
      .dancer-profile-preview-overlay .profile-media-viewer-previous, .dancer-profile-preview-overlay .profile-media-viewer-next { position:fixed; top:50%; width:46px; height:58px; display:grid; place-items:center; padding:0; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#fff; background:rgba(5,5,8,.58); font-size:34px; transform:translateY(-50%); cursor:pointer; backdrop-filter:blur(8px); }
      .dancer-profile-preview-overlay .profile-media-viewer-previous { left:12px; }
      .dancer-profile-preview-overlay .profile-media-viewer-next { right:12px; }
      .dancer-profile-preview-overlay .profile-media-viewer-previous:disabled, .dancer-profile-preview-overlay .profile-media-viewer-next:disabled { opacity:0; pointer-events:none; }
      .dancer-profile-preview-overlay .profile-media-viewer-footer { min-height:68px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px max(18px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left)); border-top:1px solid rgba(255,255,255,.1); background:#07070a; }
      .dancer-profile-preview-overlay .profile-media-viewer-copy { min-width:0; display:grid; gap:3px; }
      .dancer-profile-preview-overlay .profile-media-viewer-copy span, .dancer-profile-preview-overlay .profile-media-viewer-hint { color:#aaa0b8; font-size:11px; font-weight:800; }
      .dancer-profile-preview-overlay .profile-media-viewer-actions { min-width:92px; display:grid; justify-items:end; gap:3px; }
      .dancer-profile-preview-overlay .profile-media-viewer-share { min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:0 15px; border:1px solid rgba(255,255,255,.2); border-radius:999px; color:#fff; background:rgba(255,255,255,.08); font-size:12px; font-weight:900; cursor:pointer; }
      .dancer-profile-preview-overlay .profile-media-viewer-share svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.9; }
      .dancer-profile-preview-overlay .profile-media-viewer-share-status { min-height:14px; color:#a7f3d0; font-size:10px; font-weight:800; text-align:right; }
      .dancer-profile-preview-overlay .profile-social-section { display: grid; margin-top: 20px; margin-bottom: 8px; padding: 15px 14px 14px; border: 1px solid rgba(126,234,255,.18); border-radius: 18px; background: radial-gradient(circle at 50% 0%,rgba(126,234,255,.08),transparent 11rem),rgba(13,10,23,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.035),0 16px 38px rgba(0,0,0,.2); }
      .dancer-profile-preview-overlay .social-links-control { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .dancer-profile-preview-overlay .social-list-heading { display: grid; justify-items: center; gap: 3px; }
      .dancer-profile-preview-overlay .social-list-heading > span { color: #94e5ff; font-size: 9px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .dancer-profile-preview-overlay .social-list-heading h2 { margin: 0; font-size: 15px; line-height: 1.1; }
      .dancer-profile-preview-overlay .social-list-heading p { max-width:420px; margin:3px 0 0; color:#a9a1b5; font-size:10px; font-weight:760; line-height:1.35; }
      .dancer-profile-preview-overlay .social-list { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
      .dancer-profile-preview-overlay .social-list :is(a,button) { width: 48px; min-width: 48px; height: 48px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 48px; padding: 0; border: 1px solid rgba(139,92,246,.34); border-radius: 50%; color: #fff; background: linear-gradient(135deg,rgba(139,92,246,.14),rgba(34,199,255,.06)); box-shadow: inset 0 1px 0 rgba(255,255,255,.045); text-decoration: none; transition: border-color .16s ease,background .16s ease,box-shadow .16s ease,transform .16s ease; }
      .dancer-profile-preview-overlay .social-list :is(a,button):hover { border-color: rgba(126,234,255,.56); background: linear-gradient(135deg,rgba(139,92,246,.22),rgba(34,199,255,.12)); box-shadow: 0 0 18px rgba(34,199,255,.1); transform: translateY(-1px); }
      .dancer-profile-preview-overlay .social-list :is(a,button):focus-visible { border-color: #7eeaff; outline: 2px solid rgba(126,234,255,.72); outline-offset: 3px; }
      .dancer-profile-preview-overlay .social-list :is(a,button) svg { width: 23px; height: 23px; display: block; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dancer-profile-preview-overlay .social-list :is(.social-link-instagram,.social-link-x) svg { fill: none; }
      .dancer-profile-preview-overlay .social-list :is(a,button) .logo-cutout { fill: #0d0a17; stroke: none; }
      .dancer-profile-preview-overlay .profile-schedule-section { display: grid; gap: 14px; margin-top: 24px; padding: 18px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); }
      .dancer-profile-preview-overlay .profile-schedule-section .eyebrow { color:#f7f2ff; }
      .dancer-profile-preview-overlay .profile-section-heading { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .dancer-profile-preview-overlay .profile-section-heading > div { min-width: 0; display: grid; gap: 5px; }
      .dancer-profile-preview-overlay .profile-section-heading h2 { max-width: 100%; margin: 0; overflow-wrap: anywhere; color: #fff; font-size: clamp(22px,5vw,32px); line-height: 1.05; }
      .dancer-profile-preview-overlay .profile-section-heading > span { align-self: start; color: #9487a5; font-size: 11px; font-weight: 850; white-space: nowrap; }
      .dancer-profile-preview-overlay .profile-schedule-section > p { margin:0; color:#cfc5de; font-size:13px; line-height:1.45; }
      .dancer-profile-preview-overlay .profile-deal-availability { margin-top:12px; border:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .venue-qr-unavailable { width:100%; min-height:140px; display:grid; grid-template-columns:minmax(0,1fr) 128px; align-items:center; justify-self:stretch; gap:14px; padding:14px 15px; border:1px solid rgba(148,163,184,.13); border-radius:18px; color:rgba(203,196,214,.76); background:rgba(17,17,24,.82); box-shadow:none; text-align:left; }
      .dancer-profile-preview-overlay .profile-tonight-card { margin-top:12px; overflow:hidden; border:1px solid rgba(139,92,246,.24); border-radius:15px; background:linear-gradient(145deg,rgba(13,11,21,.94),rgba(6,7,11,.98)); box-shadow:0 12px 32px rgba(0,0,0,.26); }
      .dancer-profile-preview-overlay .profile-tonight-card > .profile-schedule-section { width:100%; margin:0; padding:14px; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-tonight-deal { padding:5px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-profile-preview-overlay .profile-tonight-deal .venue-qr-unavailable { min-height:76px; padding:6px 8px; border:0; border-radius:0; background:transparent; }
      .dancer-profile-preview-overlay .profile-deal-availability::before, .dancer-profile-preview-overlay .profile-deal-availability::after, .dancer-profile-preview-overlay .venue-qr-unavailable::before, .dancer-profile-preview-overlay .venue-qr-unavailable::after { content:none !important; display:none !important; background:none !important; box-shadow:none !important; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon { width:128px; min-width:128px; min-height:112px; display:grid; grid-template-rows:42px auto; place-items:center; align-content:center; gap:8px; padding:12px 10px; border:1px solid rgba(148,163,184,.18); border-radius:14px; color:rgba(203,196,214,.58); background:rgba(255,255,255,.035); box-shadow:inset 0 1px 0 rgba(255,255,255,.03); opacity:1; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon > svg { width:42px; height:42px; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon .qr-finder { fill:none; stroke:currentColor; stroke-width:2; stroke-linejoin:miter; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-icon .qr-module { fill:currentColor; stroke:none; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-copy { min-width:0; display:grid; justify-items:start; gap:7px; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-label { color:rgba(203,196,214,.76); font-size:clamp(18px,5vw,23px); font-weight:950; letter-spacing:-.015em; line-height:1.05; }
      .dancer-profile-preview-overlay .venue-qr-unavailable-copy small { color:rgba(203,196,214,.7); font-size:11px; font-weight:800; line-height:1.3; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy { display:grid; gap:2px; text-align:center; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy strong { color:rgba(203,196,214,.7); font-size:12px; font-weight:950; line-height:1.08; }
      .dancer-profile-preview-overlay .venue-qr-placeholder-copy small { color:rgba(203,196,214,.64); font-size:9px; font-weight:850; line-height:1.12; }
      .dancer-profile-preview-overlay .live-actions { position:relative; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); column-gap:4px; row-gap:0; padding:3px 0 0; }
      .dancer-profile-preview-overlay .live-actions > button, .dancer-profile-preview-overlay .profile-action-share-slot .profile-share button { width:100%; min-height:48px; display:inline-flex; align-items:center; justify-content:center; padding:7px 10px; border:1px solid rgba(148,229,255,.24); border-radius:12px; color:#fff; background:rgba(148,229,255,.075); cursor:pointer; font-size:12px; font-weight:900; text-align:center; }
      .dancer-profile-preview-overlay .live-actions > button:disabled { opacity:.66; cursor:default; }
      .dancer-profile-preview-overlay .live-actions .profile-action-going { flex-direction:column; gap:2px; }
      .dancer-profile-preview-overlay .live-actions .profile-action-primary { border-color:rgba(126,234,255,.48); background:linear-gradient(135deg,rgba(109,40,217,.86),rgba(11,148,201,.74)); box-shadow:0 12px 30px rgba(49,46,129,.2),0 0 18px rgba(34,199,255,.08); }
      .dancer-profile-preview-overlay .live-actions .profile-action-primary.profile-action-unavailable { border-color:rgba(148,137,166,.3); color:#bdb4ca; background:rgba(255,255,255,.055); }
      .dancer-profile-preview-overlay .live-actions .profile-action-unavailable { flex-direction:column; gap:1px; border-color:rgba(148,137,166,.22); color:#958b9f; background:rgba(255,255,255,.03); box-shadow:none; }
      .dancer-profile-preview-overlay .live-actions .profile-action-unavailable .profile-action-requirement { color:#83798d; }
      .dancer-profile-preview-overlay .profile-action-requirement { color:#c7bbd8; font-size:8px; font-weight:850; line-height:1.1; }
      .dancer-profile-preview-overlay .profile-action-requires-account { flex-direction:column; gap:1px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-main { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame { width:15px; height:15px; display:inline-grid; flex:0 0 15px; place-items:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-preview-icon { --profile-icon-offset-x:0px; --profile-icon-offset-y:0px; width:15px; height:15px; display:block; fill:none; stroke:currentColor; stroke-width:2.1; stroke-linecap:round; stroke-linejoin:round; transform:translate(var(--profile-icon-offset-x), var(--profile-icon-offset-y)); transform-origin:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width:16.25px; height:16.25px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width:13.75px; height:13.75px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width:15.25px; height:15.25px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-frame[data-profile-action-icon="share"] .profile-action-preview-icon { width:13px; height:13px; }
      .dancer-profile-preview-overlay .live-actions > button.profile-action-icon-control, .dancer-profile-preview-overlay .profile-action-share-slot .profile-share > button.profile-action-icon-control { min-height:54px; align-self:stretch; flex-direction:column; justify-content:flex-start; gap:1px; padding:2px; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-main { flex-direction:column; gap:2px; overflow:visible; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-main > span { overflow:visible; color:#ded8e7; font-size:10px; line-height:1.05; text-overflow:clip; white-space:nowrap; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame { width:24px; height:24px; flex-basis:24px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon { width:24px; height:24px; padding:0; border:0; border-radius:0; color:#d9d2e2; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-personPlus { --profile-icon-offset-x:.5px; --profile-icon-offset-y:-.5px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-bell { --profile-icon-offset-y:-1px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-preview-icon-clock { --profile-icon-offset-x:-.5px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width:26px; height:26px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width:22px; height:22px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width:24px; height:24px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control.profile-action-going:not(.profile-action-unavailable) .profile-action-preview-icon { color:#a78bfa; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .live-actions > button.profile-action-icon-control.profile-action-unavailable:disabled { color:#766e7f; background:transparent; opacity:1; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-icon-control.profile-action-unavailable .profile-action-preview-icon { border:0; color:#756d7d; background:transparent; box-shadow:none; }
      .dancer-profile-preview-overlay .profile-action-icon-control .profile-action-requirement { max-width:100%; overflow:hidden; color:#8e8498; font-size:7px; text-overflow:ellipsis; white-space:nowrap; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-preview-static:disabled { opacity:1; cursor:default; }
      .dancer-profile-preview-overlay .profile-action-share-slot, .dancer-profile-preview-overlay .profile-action-overflow { position:relative; min-width:0; }
      .dancer-profile-preview-overlay .profile-action-share-slot { grid-column:auto; }
      .dancer-profile-preview-overlay .profile-action-share-slot .profile-share { display:block; min-height:54px; }
      .dancer-profile-preview-overlay .profile-action-share-slot .profile-share button { gap:6px; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action), .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-share-slot .profile-share button.profile-action-preview-share { display:grid; grid-template-rows:18px 9px; align-content:center; justify-items:center; row-gap:1px; column-gap:0; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-main, .dancer-profile-preview-overlay .dancer-profile-preview-actions .profile-action-share-slot .profile-share button .profile-action-main { grid-row:1; }
      .dancer-profile-preview-overlay .dancer-profile-preview-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-requirement { grid-row:2; }
      .dancer-profile-preview-overlay .profile-action-overflow-toggle { width:100%; min-height:48px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:7px 10px; border:1px solid rgba(148,229,255,.18); border-radius:12px; color:#d8d0e4; background:rgba(255,255,255,.04); cursor:default; font-size:12px; font-weight:900; }
      .dancer-profile-preview-overlay .profile-action-overflow-toggle > span:first-child { color:#9fefff; font-size:15px; letter-spacing:.08em; line-height:1; }
      .dancer-profile-preview-overlay .profile-overview { display:block; margin-top:0; padding:2px 0 0; border:0; }
      .dancer-profile-preview-overlay .profile-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin:0; }
      .dancer-profile-preview-overlay .profile-metrics > div { min-width:0; display:grid; gap:3px; justify-items:center; padding:6px 4px; }
      .dancer-profile-preview-overlay .profile-metrics dd { margin:0; color:#eee9f5; font-size:clamp(19px,3.75vw,24px); font-weight:900; letter-spacing:.01em; line-height:1.08; }
      .dancer-profile-preview-overlay .profile-metrics dt { color:#8f849c; font-size:clamp(9px,2.1vw,11px); font-weight:850; line-height:1.25; text-align:center; }
      .dancer-profile-preview-overlay .dancer-profile-preview-status > p { color: #cfc5de; font-size: 13px; line-height: 1.45; }
      .dancer-profile-preview-overlay.is-editor { z-index:1510; }
      .dancer-profile-preview-overlay.is-editor .dancer-profile-preview-shell { padding-bottom: max(156px,calc(env(safe-area-inset-bottom) + 136px)); }
      body.dancr-button-system .dancer-profile-preview-overlay.is-editor .profile-titlebar { display:grid !important; grid-template-columns:72px minmax(0,1fr); align-items:center; gap:12px !important; padding:12px 52px 12px 0 !important; }
      body.dancr-button-system .dancer-profile-preview-overlay.is-editor .profile-titlebar-identity { display:grid !important; gap:8px !important; overflow:visible !important; }
      .dancer-profile-builder-avatar-control { width:72px; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:64px auto; justify-items:center; align-content:center; gap:7px; padding:0; border:0; color:#fff; background:transparent; font:inherit; cursor:pointer; }
      .dancer-profile-builder-avatar-control > small { width:100%; display:block; color:#e5dfee !important; -webkit-text-fill-color:currentColor !important; font-size:11px; font-weight:750; line-height:1.3; text-align:center; }
      .dancer-profile-builder-avatar { width:64px; min-width:64px; max-width:64px; height:64px; min-height:64px; max-height:64px; aspect-ratio:1; padding:0; line-height:0; }
      .dancer-profile-builder-avatar.is-empty { border:1px solid #645778 !important; color:#d5baff !important; background:linear-gradient(145deg,#221333,#100d18) !important; }
      .dancer-profile-builder-avatar-camera { width:26px; height:26px; display:block; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      body.dancr-button-system .dancer-profile-preview-overlay.is-editor .dancer-profile-builder-avatar-camera, body.dancr-button-system .dancer-profile-preview-overlay.is-editor .dancer-profile-builder-avatar-camera * { color:#d5baff !important; stroke:#d5baff !important; fill:none !important; }
      body.dancr-button-system .dancer-profile-builder-avatar-control { min-height:88px !important; padding:0 !important; border:0 !important; border-radius:12px !important; background:transparent !important; box-shadow:none !important; }
      body.dancr-button-system .dancer-profile-preview-overlay .dancer-profile-builder-avatar { width:64px !important; height:64px !important; flex-basis:64px !important; border-radius:50% !important; box-shadow:none !important; }
      .dancer-profile-builder-identity, .dancer-profile-builder-city { width:100%; min-width:0; min-height:56px; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 11px; border:1px solid #40384b; border-radius:12px; color:#fff; background:#131019; font:inherit; text-align:left; cursor:pointer; }
      .dancer-profile-builder-field-copy { min-width:0; display:grid; gap:4px; }
      .dancer-profile-builder-field-copy > small { color:#d4cedd !important; -webkit-text-fill-color:currentColor !important; font-size:11px; font-weight:650; line-height:1.2; }
      .dancer-profile-builder-field-copy > span { min-width:0; overflow:hidden; color:#fff; font-size:15px; font-weight:800; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
      .dancer-profile-builder-identity > svg, .dancer-profile-builder-city > svg { width:16px; height:16px; flex:0 0 16px; fill:none; stroke:#c9c3d2; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      body.dancr-button-system .dancer-profile-builder-identity, body.dancr-button-system .dancer-profile-builder-city { min-height:56px !important; padding:9px 11px !important; border:1px solid #40384b !important; border-radius:12px !important; background:#131019 !important; box-shadow:none !important; }
      .dancer-profile-builder-avatar-control:focus-visible, .dancer-profile-builder-identity:focus-visible, .dancer-profile-builder-city:focus-visible { outline:2px solid #d5baff; outline-offset:3px; }

      .dancer-profile-builder-media-actions { width:min(100%,760px); max-width:100%; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin:10px auto 0; }
      .dancer-profile-builder-media-actions button { min-height:46px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid rgba(126,234,255,.24); border-radius:12px; color:#effcff; background:linear-gradient(145deg,rgba(124,58,237,.14),rgba(34,199,255,.06)); font:inherit; font-size:12px; font-weight:900; cursor:pointer; }
      .dancer-profile-builder-media-actions button span { width:21px; height:21px; display:grid; place-items:center; border-radius:50%; background:rgba(126,234,255,.12); }
      .dancer-profile-builder-social-platform { position:relative; cursor:pointer; }
      .dancer-profile-builder-social-platform > svg { position:relative; z-index:1; }
      .dancer-profile-builder-social-platform > span { position:absolute; z-index:2; top:-2px; right:-2px; width:18px; height:18px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.34); border-radius:50%; color:#fff; background:#5b20c8; box-shadow:0 3px 9px rgba(0,0,0,.5); font-size:12px; font-weight:950; line-height:1; }
      .dancer-profile-builder-social-platform.is-added { border-color:rgba(64,220,148,.58) !important; background:rgba(36,176,112,.1) !important; }
      .dancer-profile-builder-social-platform.is-added > span { border-color:rgba(139,255,199,.55); background:#168558; }
      body.dancr-button-system .public-profile-shell .dancer-profile-builder-social-platform { width:48px !important; min-width:48px !important; height:48px !important; min-height:48px !important; flex:0 0 48px !important; padding:0 !important; border-radius:50% !important; }
      .dancer-social-link-modal-backdrop { position:fixed; z-index:35; inset:0; display:grid; align-items:end; justify-items:center; padding:12px max(12px,env(safe-area-inset-right)) max(12px,calc(92px + env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left)); background:rgba(0,0,0,.66); backdrop-filter:blur(4px); }
      .dancer-profile-builder-panel.dancer-social-link-modal { position:relative; z-index:1; inset:auto; left:auto; bottom:auto; width:min(100%,460px); max-height:min(72dvh,440px); grid-template-rows:auto minmax(0,1fr); padding:0; border:1px solid rgba(139,92,246,.34); border-radius:20px; background:linear-gradient(180deg,rgba(16,13,25,.995),rgba(7,7,11,.998)); box-shadow:0 24px 80px rgba(0,0,0,.68),0 0 30px rgba(124,58,237,.16); transform:none; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header { position:static; gap:12px; padding:14px 14px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:transparent; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header > button { width:42px; min-width:42px; height:42px; min-height:42px; flex:0 0 42px; }
      .dancer-profile-builder-panel.dancer-social-link-modal > div { overflow-x:hidden; overflow-y:auto; padding:14px; scroll-padding-bottom:16px; }
      .dancer-social-link-modal-heading { min-width:0; display:flex; align-items:center; gap:11px; }
      .dancer-social-link-modal-heading > span { width:40px; height:40px; display:grid; flex:0 0 40px; place-items:center; border:1px solid rgba(139,92,246,.36); border-radius:50%; color:#fff; background:rgba(124,58,237,.1); }
      .dancer-social-link-modal-heading > span svg { width:21px; height:21px; display:block; fill:currentColor; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .dancer-social-link-modal-heading.is-instagram > span { color:#ff6b9a; }
      .dancer-social-link-modal-heading.is-tiktok > span { color:#48e8ed; }
      .dancer-social-link-modal-heading.is-snapchat > span { color:#ffe84a; }
      .dancer-social-link-modal-heading.is-x > span { color:#f4f1f8; }
      .dancer-social-link-modal-heading.is-onlyfans > span { color:#46c7ed; }
      .dancer-social-link-modal-heading.is-instagram svg,
      .dancer-social-link-modal-heading.is-x svg { fill:none; }
      .dancer-social-link-modal-heading .logo-cutout { fill:#0b0a11; stroke:none; }
      .dancer-profile-builder-panel.dancer-social-link-modal > header h2 { min-width:0; overflow-wrap:anywhere; font-size:clamp(19px,5vw,23px); line-height:1.1; }
      .dancer-social-link-form { display:grid !important; grid-template-columns:1fr !important; gap:11px !important; align-items:stretch !important; }
      .dancer-social-link-form > label { min-width:0; display:grid; gap:7px; color:#d9d4e1; font-size:12px; font-weight:900; line-height:1.2; }
      .dancer-social-link-form input { width:100%; min-width:0; min-height:50px; box-sizing:border-box; padding:0 14px; border:1px solid rgba(148,163,184,.42); border-radius:13px; outline:none; color:#f8fafc; background:#111118; font:inherit; font-size:16px; }
      .dancer-social-link-form input::placeholder { color:#94a3b8; opacity:.78; }
      .dancer-social-link-form input:focus { border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.2); }
      .dancer-social-link-form .dancer-form-save-state { min-height:0; margin:0; color:#cbd5e1; font-size:11px; line-height:1.35; }
      .dancer-social-link-form .dancer-form-save-state.is-unsaved { color:#fda4af; }
      .dancer-social-link-save,
      .dancer-social-link-remove { width:100%; min-height:48px; border-radius:13px; font:inherit; font-size:14px; font-weight:950; cursor:pointer; }
      .dancer-social-link-save { border:1px solid rgba(196,181,253,.5); color:#fff; background:#7c3aed; box-shadow:0 0 18px rgba(124,58,237,.18); }
      .dancer-social-link-remove { min-height:42px; border:1px solid rgba(239,68,68,.32); color:#fecaca; background:rgba(239,68,68,.08); box-shadow:none; }
      .dancer-social-link-save:disabled,
      .dancer-social-link-remove:disabled,
      .dancer-profile-builder-panel.dancer-social-link-modal > header > button:disabled { cursor:wait; opacity:.58; }
      body.dancr-button-system .dancer-social-link-save { min-height:48px !important; border-color:rgba(196,181,253,.5) !important; border-radius:13px !important; color:#fff !important; background:#7c3aed !important; box-shadow:0 0 18px rgba(124,58,237,.18) !important; }
      body.dancr-button-system .dancer-social-link-remove { min-height:42px !important; border-color:rgba(239,68,68,.32) !important; border-radius:13px !important; color:#fecaca !important; background:rgba(239,68,68,.08) !important; box-shadow:none !important; }
      .dancer-profile-builder-panel { position:fixed; z-index:30; left:50%; bottom:0; width:min(calc(100% - 24px),760px); max-height:min(88dvh,780px); box-sizing:border-box; display:grid; grid-template-rows:auto minmax(0,1fr); overflow:hidden; padding:0 max(12px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); border:1px solid rgba(126,234,255,.28); border-bottom:0; border-radius:22px 22px 0 0; outline:none; color:#f7f2ff; background:linear-gradient(180deg,rgba(15,12,25,.995),rgba(5,5,8,.998)); box-shadow:0 -24px 80px rgba(0,0,0,.72),0 0 36px rgba(109,40,217,.2); transform:translateX(-50%); }
      .dancer-profile-builder-panel[hidden] { display:none; }
      .dancer-profile-builder-panel > header { position:sticky; z-index:2; top:0; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 2px 9px; border-bottom:1px solid rgba(255,255,255,.09); background:rgba(14,11,23,.98); }
      .dancer-profile-builder-panel > header h2 { margin:0; font-size:clamp(20px,5vw,28px); line-height:1.05; }
      .dancer-profile-builder-panel > header button { width:40px; min-width:40px; height:40px; min-height:40px; display:grid; grid-template:1fr / 1fr; gap:0; place-items:center; padding:0; border:1px solid rgba(255,255,255,.14); border-radius:50%; color:#fff; background:rgba(255,255,255,.06); font-size:0; line-height:0; cursor:pointer; }
      .dancer-profile-builder-panel > header button svg { width:22px; height:22px; display:block; overflow:visible; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
      .dancer-profile-builder-panel > div { min-width:0; max-width:100%; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; padding:10px 0 max(28px,env(safe-area-inset-bottom)); scroll-padding-bottom:max(28px,env(safe-area-inset-bottom)); scrollbar-width:thin; }
      .dancer-profile-builder-panel > div > * { width:100%; max-width:100%; min-width:0; box-sizing:border-box; }
      .dancer-profile-builder-panel .info-panel { grid-column:1 / -1; max-width:100%; box-sizing:border-box; overflow:hidden; padding:12px; }
      .dancer-profile-builder-panel .upload-panel > h2 { display:none; }
      .dancer-profile-builder-panel .photo-upload-heading { justify-content:flex-end; }
      .dancer-profile-builder-panel .photo-upload-heading > span { display:none; }
      .dancer-profile-builder-panel .photo-slot-summary { justify-content:center; }
      .dancer-profile-builder-panel .photo-slot-summary > span { display:none; }
      .dancer-profile-builder-panel[data-section="photos"] > div { padding-top:7px; padding-bottom:max(12px,env(safe-area-inset-bottom)); scroll-padding-bottom:max(12px,env(safe-area-inset-bottom)); }
      .dancer-profile-builder-panel[data-section="photos"] .upload-panel { gap:8px; padding:8px; border-radius:14px; }
      .dancer-profile-builder-panel[data-section="photos"] .dancer-photo-upload-form { grid-template-columns:auto auto; align-items:center; justify-content:center; gap:8px 12px; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-upload-heading { display:none; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-primary-choice,
      .dancer-profile-builder-panel[data-section="photos"] .photo-upload-status { grid-column:1 / -1; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-source-grid { margin:0; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-slot-summary { width:auto; justify-content:flex-start; white-space:nowrap; }
      .dancer-profile-builder-panel[data-section="photos"] .photo-review-list:empty,
      .dancer-profile-builder-panel[data-section="photos"] .photo-review-list > p:only-child { display:none; }
      .dancer-profile-builder-panel .photo-source-grid,
      .dancer-profile-builder-panel .tv-video-source-grid { width:fit-content !important; max-width:100%; grid-template-columns:repeat(2,58px) !important; grid-auto-rows:58px !important; justify-content:center; gap:14px; margin-inline:auto; }
      .dancer-profile-builder-panel .photo-source-action,
      .dancer-profile-builder-panel .tv-video-source-action { width:58px !important; min-width:58px !important; max-width:58px !important; height:58px !important; min-height:58px !important; max-height:58px !important; display:grid !important; grid-template-columns:1fr !important; place-items:center; gap:0 !important; overflow:hidden; padding:0 !important; border-radius:50% !important; text-align:center; }
      .dancer-profile-builder-panel .photo-source-icon,
      .dancer-profile-builder-panel .tv-video-source-icon { width:100%; height:100%; border-radius:50%; background:rgba(34,199,255,.08); }
      .dancer-profile-builder-panel .photo-source-icon svg,
      .dancer-profile-builder-panel .tv-video-source-icon svg { width:26px; height:26px; }
      .dancer-profile-builder-panel .photo-source-copy,
      .dancer-profile-builder-panel .photo-source-cta,
      .dancer-profile-builder-panel .tv-video-source-copy,
      .dancer-profile-builder-panel .tv-video-source-cta { display:none; }
      .dancer-profile-builder-panel .tv-studio-embedded-head { justify-content:flex-end; margin-bottom:8px; }
      .dancer-profile-builder-panel .tv-studio-embedded-head > div { display:none; }
      .dancer-profile-builder-panel .tv-upload-form { width:100%; max-width:100%; box-sizing:border-box; gap:10px; padding:12px; overflow:hidden; }
      .dancer-profile-builder-panel .tv-upload-permissions strong { font-size:13px; }
      .dancer-profile-builder-panel .tv-upload-requirements { line-height:1.35; overflow-wrap:anywhere; }
      .dancer-avatar-source-grid { width:100%; }
      .dancer-profile-preview-overlay.is-editor .dancer-profile-editor-footer { position:fixed; z-index:18; left:50%; bottom:0; width:min(calc(100% - 24px),760px); margin:0; transform:translateX(-50%); }
      .dancer-profile-editor-tools { width:min(100%,760px); max-width:100%; min-width:0; box-sizing:border-box; display:grid; gap:14px; margin:24px auto 0; padding:18px; border:1px solid rgba(139,92,246,.3); border-radius:20px; background:linear-gradient(180deg,rgba(13,10,23,.96),rgba(7,7,11,.98)); box-shadow:0 24px 70px rgba(0,0,0,.34),inset 3px 0 0 rgba(139,92,246,.72); }
      .dancer-profile-editor-tools > header { display:grid; gap:6px; padding:0 2px 4px; }
      .dancer-profile-editor-tools > header h2,.dancer-profile-editor-tools > header p { margin:0; }
      .dancer-profile-editor-tools > header h2 { color:#fff; font-size:clamp(24px,5vw,34px); line-height:1.05; }
      .dancer-profile-editor-tools > header p { color:#b9accd; font-size:13px; line-height:1.45; }
      .dancer-profile-editor-grid { min-width:0; }
      .dancer-profile-editor-grid > .info-panel { grid-column:1 / -1; }
      .dancer-profile-editor-footer { position:sticky; z-index:12; bottom:0; width:min(100%,760px); max-width:100%; min-width:0; box-sizing:border-box; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; margin:18px auto 0; padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); border:1px solid rgba(126,234,255,.2); border-bottom:0; border-radius:18px 18px 0 0; background:rgba(7,7,11,.94); box-shadow:0 -16px 42px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.04); backdrop-filter:blur(22px); }
      .dancer-profile-editor-footer p { margin:0; color:#b9accd; font-size:11px; line-height:1.4; }
      .dancer-profile-editor-footer button { min-width:230px; min-height:48px; padding:0 18px; border:1px solid rgba(126,234,255,.5); border-radius:13px; color:#fff; background:linear-gradient(135deg,#7c2be8,#087fae); box-shadow:0 10px 28px rgba(79,30,174,.3); font:inherit; font-size:13px; font-weight:950; cursor:pointer; }
      .dancer-profile-editor-footer button:disabled { opacity:.62; cursor:wait; }
      .dancer-profile-preview-overlay[data-photo-deleting="true"] button:disabled { opacity:1 !important; filter:none !important; cursor:wait !important; }
      .dancer-onboarding-primary { width: 100%; min-height: 52px; border: 1px solid rgba(196,122,255,.72); border-radius: 14px; color: #fff; background: linear-gradient(135deg, #8b20ef, #6d19d6); box-shadow: 0 10px 25px rgba(117,28,215,.2); font: inherit; font-weight: 950; cursor: pointer; }
      .dancer-onboarding-primary:disabled { opacity: .58; cursor: wait; }
      .dancer-onboarding-steps button:focus-visible, .dancer-onboarding-primary:focus-visible, .dancer-avatar-panel button:focus-visible, .dancer-avatar-panel input:focus-visible { outline: 2px solid #7eeaff; outline-offset: -3px; }
      .dancer-onboarding-announcement { min-height: 20px; color: #bfefff; font-size: 12px; font-weight: 760; line-height: 1.4; }
      .dancer-onboarding-secondary { min-height:52px; border:1px solid rgba(255,255,255,.14); border-radius:14px; color:#f4f2f7; background:#24242c; font:inherit; font-weight:900; cursor:pointer; }
      .dancer-avatar-panel { grid-column: span 3; display: grid; gap: 13px; }
      .dancer-avatar-editor { display: grid; grid-template-columns: 78px minmax(0,1fr); align-items: center; gap: 14px; }
      .dancer-avatar-preview { width: 74px; height: 74px; font-size: 26px; }
      .dancer-avatar-editor > span:last-child { display: grid; gap: 5px; }
      .dancer-avatar-editor strong { color: #fff; }
      .dancer-avatar-editor small { color: var(--mydancr-dashboard-muted); line-height: 1.4; }
      .dancer-avatar-upload-controls { display: grid; grid-template-columns: minmax(0,1fr) auto auto; align-items: end; gap: 10px; }
      .dancer-avatar-upload-controls progress { width: 100%; height: 8px; grid-column: 1 / -1; accent-color: #7eeaff; }
      .dancer-avatar-panel label { display: grid; gap: 7px; color: #d7d5dd; font-size: 13px; font-weight: 850; }
      .dancer-avatar-panel input { min-height: 48px; box-sizing: border-box; padding: 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: #16161b; }
      .dancer-avatar-panel button { min-height: 48px; padding: 0 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: #fff; background: #17171d; font: inherit; font-weight: 900; cursor: pointer; }
      .dancer-avatar-panel p { color: var(--mydancr-dashboard-muted); font-size: 12px; }
      .dashboard-shell-venue { --mydancr-dashboard-panel: #09090d; --mydancr-dashboard-panel-raised: #111116; --mydancr-dashboard-border: rgba(255,255,255,.105); --mydancr-dashboard-muted: rgba(218,218,226,.68); color-scheme: dark; background: #050507; }
      .dashboard-shell .dashboard-head { border-color: var(--mydancr-dashboard-border); background: #07070a; }
      .dashboard-shell-venue .venue-command-primary,
      .dashboard-shell .venue-dashboard-section,
      .dashboard-shell-venue .venue-dashboard-metrics { border-color: var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel); }
      .dashboard-shell-venue .venue-command-primary { background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell .venue-dashboard-section[open] > summary { background: rgba(255,255,255,.022); }
      .dashboard-shell .venue-dashboard-section-badge { border-color: rgba(255,255,255,.13); color: #d7d5dd; background: rgba(255,255,255,.045); }
      .dashboard-shell-dancer #dancer-performance .venue-dashboard-section-badge { border-color: rgba(245,158,11,.42); color: #fde68a; background: rgba(245,158,11,.12); box-shadow: 0 0 16px rgba(245,158,11,.08); }
      .dashboard-shell .venue-dashboard-section-body > .info-panel,
      .dashboard-shell .venue-dashboard-inner-grid > .info-panel { border-color: transparent; background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell-customer .venue-dashboard-section { border-color: rgba(167,139,250,.18); background: linear-gradient(145deg,rgba(17,11,29,.78),rgba(7,7,11,.98) 74%); }
      .dashboard-shell-customer .venue-dashboard-section > summary { min-height: 68px; padding: 14px 16px; }
      .dashboard-shell-customer .venue-dashboard-section[open] > summary { border-color: rgba(167,139,250,.16); background: rgba(139,92,246,.055); }
      .dashboard-shell-customer .venue-dashboard-section-body { gap: 14px; padding: 14px; }
      .dashboard-shell-customer #customer-followed-dancers .venue-dashboard-section-body,
      .dashboard-shell-customer #customer-followed-clubs .venue-dashboard-section-body { padding: 12px 14px 15px; }
      .dashboard-shell-customer .venue-dashboard-section-badge { min-width: 28px; min-height: 26px; box-sizing: border-box; display: grid; place-items: center; padding: 0 8px; border-color: rgba(196,181,253,.38); color: #f3efff; background: rgba(124,58,237,.3); font-size: 11px; }
      .dashboard-shell-customer .venue-dashboard-section-toggle { border-color: rgba(167,139,250,.38); background: rgba(124,58,237,.17); }
      .dashboard-shell-customer .venue-dashboard-section-body > .info-panel,
      .dashboard-shell-customer .venue-dashboard-inner-grid > .info-panel { border-color: rgba(167,139,250,.1); background: rgba(255,255,255,.025); }
      .dashboard-shell-customer .notification-unread-pill { border-color: rgba(167,139,250,.34); color: #e9e1ff; background: rgba(124,58,237,.2); }
      .dashboard-shell-customer .notification-row { border-color: rgba(167,139,250,.12); }
      .dashboard-shell-customer .notification-row:hover { border-color: rgba(167,139,250,.3); background: rgba(139,92,246,.07); }
      .dashboard-shell-customer .notification-row .notification-row-meta,
      .dashboard-shell-customer .notification-row em,
      .dashboard-shell-customer .notification-panel > p { color: #c9bbf3; }
      .dashboard-shell-customer .support-message.from-admin { border-color: rgba(167,139,250,.28); background: rgba(124,58,237,.1); }
      .dashboard-shell-venue .venue-working-list span { color: #76f0c8; }
      .dashboard-shell-venue .venue-deal-panel,
      .dashboard-shell-venue .venue-verification-panel { border-color: var(--mydancr-dashboard-border); background: var(--mydancr-dashboard-panel-raised); }
      .dashboard-shell-venue .venue-deal-placement-note { color: var(--mydancr-dashboard-muted) !important; }
      .dashboard-shell-venue .venue-deal-list > button { border-color: var(--mydancr-dashboard-border); color: #f8f7fb; background: #141419; }
      .dashboard-shell-venue .venue-deal-list > button.add { border-style: dashed; color: #d7d5dd; }
      .dashboard-shell-venue .venue-deal-list span { color: #aaa6b2; }
      .dashboard-shell-venue .venue-deal-list small { color: #aaa6b2; }
      .dashboard-shell-venue .venue-deal-list small.is-live { color: #78ffc0; }
      .dashboard-shell-venue .venue-deal-builder-step,
      .dashboard-shell-venue .venue-deal-review,
      .dashboard-shell-venue .venue-deal-qr-generator,
      .dashboard-shell-venue .venue-deal-how,
      .dashboard-shell-venue .venue-redemption-instructions,
      .dashboard-shell-venue .commission-tier-table { border-color: var(--mydancr-dashboard-border); background: #0d0d12; box-shadow: none; }
      .dashboard-shell-venue .venue-deal-builder-step legend > span:first-child { border: 1px solid rgba(196,122,255,.8); color: #fff; background: linear-gradient(135deg, #a020f0, #6d19d6); box-shadow: 0 0 0 3px rgba(139,92,246,.12), 0 0 18px rgba(139,92,246,.36); }
      .dashboard-shell-venue .venue-deal-rule-note,
      .dashboard-shell-venue .venue-redemption-instructions { border-color: rgba(255,255,255,.18); color: #c9c7d0; background: rgba(255,255,255,.035); }
      .dashboard-shell-venue .venue-deal-panel label { color: #d7d5dd; }
      .dashboard-shell-venue .venue-deal-panel input,
      .dashboard-shell-venue .venue-deal-panel textarea,
      .dashboard-shell-venue .venue-deal-panel select { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #16161b; }
      .dashboard-shell-venue .venue-deal-panel button { border: 1px solid rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; box-shadow: none; }
      .dashboard-shell-venue .venue-deal-live-list > button { border-color: rgba(16,185,129,.28); background: rgba(16,185,129,.07); }
      .dashboard-shell-venue .venue-deal-control-actions > button.venue-deal-control-primary { border-color: rgba(196,181,253,.54); color: #fff; background: #7c3aed; box-shadow: 0 0 16px rgba(124,58,237,.18); }
      .dashboard-shell-venue .venue-deal-form-actions .primary { border-color: rgba(196,122,255,.72); color: #fff; background: linear-gradient(135deg, #8b20ef, #6d19d6); }
      .dashboard-shell-venue .venue-deal-form-actions .secondary { color: #f8f7fb; background: #17171d; }
      .dashboard-shell-venue .venue-deal-form-actions .danger { border-color: rgba(255,86,108,.3); color: #ffccd3; background: rgba(255,86,108,.12); }
      .dashboard-shell-venue .venue-deal-share-options { border-color: var(--mydancr-dashboard-border); background: rgba(255,255,255,.025); }
      .dashboard-shell-venue .venue-deal-share-options button { border-color: rgba(255,255,255,.14); color: #f8f7fb; background: #17171d; }
      .dashboard-shell-venue .venue-deal-how > summary::after { color: #c4b5fd; }
      .dashboard-shell-venue .currency-input { border-color: rgba(255,255,255,.14); background: #16161b; }
      .dashboard-shell-venue .currency-input > span,
      .dashboard-shell-venue .commission-tier-table > strong { color: #d7d5dd; }
      .dashboard-shell-venue .commission-tier-table > strong { background: rgba(255,255,255,.04); }
      @media (max-width: 720px) { .venue-deal-control-card { grid-template-columns: 1fr; } .venue-deal-control-actions { justify-content: flex-start; } .venue-deal-control-actions > button, .venue-deal-control-actions > a { flex: 1 1 140px; } .venue-contract-history section { grid-template-columns: 1fr; } }
      @media (max-width: 680px) {
        .dancer-performance-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .dancer-performance-summary .metric { min-height: 70px; padding: 11px 12px; }
        .dancer-performance-summary .metric:nth-child(odd) { border-left: 0; }
        .dancer-performance-summary .metric:nth-child(n + 3) { border-top: 1px solid var(--mydancr-dashboard-border); }
        .dancer-performance-detail > summary { grid-template-columns: minmax(0, 1fr) 36px; min-height: 76px; padding: 13px 14px; }
        .dancer-performance-detail > summary > b { grid-column: 1; grid-row: 2; }
        .dancer-performance-detail > summary > i { grid-column: 2; grid-row: 1 / span 2; }
        .dancer-performance-detail-body { padding: 13px; }
        .weekly-result-summary { align-items: flex-start; flex-direction: column; gap: 8px; }
        .earnings-history-tabs button { padding: 5px 8px; }
      }
      @media (max-width: 860px) { .dashboard-grid, .venue-dashboard-overview-grid, .venue-dashboard-account-grid, .setup-panel form, .upload-panel form, .verification-panel form, .shift-panel form, .shift-checkin-card, .dashboard-shift, .billing-grid, .customer-settings-panel form, .notification-head, .socials-panel form, .share-grid, .impact-grid, .deal-metrics, .customer-saved-grid, .customer-settings-grid, .venue-deal-panel form, .venue-deal-metrics, .venue-deal-qr-generator, .venue-deal-qr-generator.has-qr, .venue-verification-controls, .dancer-verification-qr, .venue-verification-preview, .venue-verification-scanner { grid-template-columns: 1fr; } .setup-panel, .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .deal-panel, .saved-deal-panel, .customer-saved-panel, .locked-analytics-panel, .visibility-panel, .venue-working-panel, .venue-deal-panel, .venue-verification-panel, .customer-settings-panel .city-field, .setup-panel label:nth-of-type(4), .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: auto; grid-row: auto; } .venue-deal-qr-preview { width: min(100%, 320px); justify-self: center; } .commission-tier-table > div { grid-template-columns: 1fr; gap: 4px; } }
      @media (max-width: 620px) { .dashboard-shell { padding-left: 12px; padding-right: 12px; } .venue-command-links { grid-template-columns: 1fr; } .venue-dashboard-section > summary { min-height: 96px; grid-template-columns: minmax(0, 1fr) auto; padding: 15px; } .venue-dashboard-section-badge { grid-column: 1; grid-row: 2; } .venue-dashboard-section-toggle { grid-column: 2; grid-row: 1 / span 2; } .venue-dashboard-section-body { padding: 10px; } .venue-deal-step-grid, .venue-deal-review, .venue-deal-share-options, .venue-verification-actions, .venue-verification-manual > div, .customer-nfc-guide { grid-template-columns: 1fr; } .venue-contract-deal-list, .venue-deal-request-center, .venue-deal-request-center > form { grid-template-columns: 1fr; } .venue-deal-request-center form button { width: 100%; } .venue-deal-request-history article { grid-template-columns: 1fr; } .customer-welcome-card { grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; padding: 14px; } .customer-welcome-lock { width: 34px; height: 34px; } .customer-welcome-copy ul { grid-template-columns: 1fr; } .customer-welcome-actions { display: grid; grid-template-columns: 1fr; } .customer-welcome-actions a { width: 100%; } .customer-welcome-card > button { width: 34px; height: 34px; } .customer-dashboard-primary-links { grid-template-columns: repeat(2, minmax(0, 1fr)); } .customer-dashboard-primary-links a { min-height: 64px; padding: 10px; font-size: 12px; } .customer-dashboard-utility-links { justify-content: stretch; } .customer-dashboard-utility-links a { flex: 1 1 0; } .customer-saved-card-grid { grid-template-columns: 1fr; } .customer-followed-dancer-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; } .customer-followed-dancer-tile { border-radius: 10px; } .customer-followed-dancer-copy { gap: 3px; padding: 32px 7px 8px; } .customer-followed-dancer-copy > strong { font-size: 14px; } .customer-followed-dancer-copy > small { font-size: 9px; } .customer-followed-dancer-copy > .customer-followed-dancer-time { font-size: 8px; } .customer-followed-dancer-status { font-size: 8px; letter-spacing: .07em; } .customer-section-heading.split { align-items: flex-start; flex-direction: column; } .customer-saved-head { align-items: center; flex-direction: row; } .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 36px; width: 36px; height: 36px; font-size: 14px; } .customer-card-actions a, .customer-card-actions button, .customer-empty-state a { min-height: 42px; } .saved-deal-bookmark { grid-template-columns: 1fr; } .saved-deal-bookmark > .customer-card-actions { justify-content: flex-start; } .customer-settings-section { padding: 12px; } .deal-metrics .metric { border-left: 0; border-top: 1px solid var(--mydancr-dashboard-border); } .deal-metrics .metric:first-child { border-top: 0; } }
      @media (max-width: 620px) {
        .customer-preference-list { grid-template-columns: 1fr; }
        .customer-preference-row { padding: 13px 11px; gap: 8px; }
        .dashboard-shell-customer .venue-dashboard-section > summary { min-height: 78px; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; padding: 12px 13px; }
        .dashboard-shell-customer .venue-dashboard-section-badge { grid-column: 2; grid-row: 1; align-self: center; }
        .dashboard-shell-customer .venue-dashboard-section-toggle { grid-column: 3; grid-row: 1; }
        .dashboard-shell-customer .venue-dashboard-section-body { padding: 11px; }
        .dashboard-shell-customer #customer-followed-dancers .venue-dashboard-section-body,
        .dashboard-shell-customer #customer-followed-clubs .venue-dashboard-section-body { padding: 10px 11px 13px; }
        .dashboard-shell-customer .customer-section-heading.split > strong,
        .dashboard-shell-customer .notification-title-row > strong { min-width: 28px; width: auto; height: 26px; font-size: 11px; }
      }
      @media (max-width: 620px) { .dancer-nats-signup-callout { grid-template-columns: 1fr; gap: 13px; padding: 15px; } .dancer-nats-signup-actions { display: grid; grid-template-columns: 1fr; justify-content: stretch; } .dancer-nats-signup-actions > a, .dancer-nats-signup-actions > button, .dancer-nats-signup-actions > b { width: 100%; min-height: 46px; } }
      @media (max-width: 520px) { .dashboard-head { padding: 10px 12px 14px; border-radius: 16px; } .dashboard-head-row { gap: 10px; } .dashboard-head h1, h1 { font-size: clamp(21px, 6vw, 26px); } .dashboard-close { flex-basis: 42px; } .notification-title-row { align-items: flex-start; } }
      @media (max-width: 520px) { .notification-toolbar { width: 100%; justify-content: flex-start; } .notification-mark-read-button { margin-left: auto; } .support-panel .support-send-button { width: 100%; } .account-action-row { gap: 10px; } .account-action-button { min-width: 78px; padding-inline: 10px; } }
      @media (max-width: 860px) { .dancer-avatar-upload-controls { grid-template-columns: 1fr; } .dancer-avatar-panel { grid-column: auto; } }
      @media (max-width: 620px) { .dashboard-shell-dancer { padding-bottom: max(40px, calc(env(safe-area-inset-bottom) + 24px)); } .dashboard-shell-dancer .dashboard-head { padding: 17px; border-radius: 20px; } .dashboard-shell-dancer .dashboard-head-title-row { align-items:flex-start; flex-direction:column; gap:7px; } .dashboard-shell-dancer .dashboard-section-summary > summary { min-height: 62px; padding: 12px 14px; } .dashboard-shell-dancer .dashboard-section-primary > summary { min-height: 74px; padding: 14px; } .dashboard-shell-dancer .dashboard-section-secondary > summary { min-height: 68px; padding: 13px 14px; } .dashboard-shell-dancer .dashboard-section-utility > summary { min-height: 60px; padding: 11px 14px; } .dancer-activation-confirmation { grid-template-columns: 44px minmax(0,1fr) 38px; gap: 10px; padding: 14px; } .dancer-activation-check { width: 42px; height: 42px; font-size: 21px; } .dancer-activation-confirmation > button { width: 38px; height: 38px; } .dancer-activation-actions { display:grid; grid-template-columns:1fr; } .dancer-profile-media-preview { grid-template-columns: 42px minmax(0,1fr); gap: 9px 11px; padding: 13px; } .dancer-profile-media-preview-icon { width: 40px; height: 40px; } .dancer-profile-media-preview-button { grid-column: 1 / -1; width: 100%; min-height: 46px; } .dancer-onboarding-command { padding: 14px; border-radius: 18px; } .dancer-onboarding-command-head { flex-direction: column; gap: 11px; } .dancer-onboarding-steps > li > button { min-height: 82px; grid-template-columns: 34px minmax(0,1fr) 28px; gap: 5px 10px; } .dancer-onboarding-step-state { grid-column: 2; width: fit-content; min-width: 0; padding: 4px 7px; } .dancer-onboarding-step-toggle { grid-column: 3; grid-row: 1 / span 2; } .dancer-onboarding-step-panel { padding: 10px; } .dancer-onboarding-primary { position: static; } .dancer-avatar-panel button, .dancer-avatar-panel input, .setup-panel button, .setup-panel input, .setup-panel select, .socials-panel button, .socials-panel input, .upload-panel button, .upload-panel input { min-height: 48px; } .dancer-onboarding-preview-card { grid-template-columns: 58px minmax(0,1fr); } .dancer-onboarding-preview-card > b { grid-column: 2; } .dancer-profile-preview-shell { padding-inline: max(12px,env(safe-area-inset-left)) max(12px,env(safe-area-inset-right)); } .dancer-profile-preview-overlay .profile-titlebar { min-height: 64px; } .dancer-profile-preview-overlay .profile-titlebar-avatar { width: 48px; height: 48px; flex-basis: 48px; } .dancer-profile-preview-overlay .profile-media-feature { aspect-ratio: 4 / 5; border-radius: 17px; } .dancer-profile-preview-overlay .profile-schedule-section { padding: 15px; } .dancer-profile-preview-overlay .profile-section-heading { gap: 10px; } }
      @media (max-width: 620px) { .dashboard-shell-dancer { padding-bottom: max(128px, calc(env(safe-area-inset-bottom) + 104px)); } .dancer-onboarding-steps > li > button { min-height: 60px; grid-template-columns: 30px minmax(0,1fr) auto; gap: 8px; padding: 9px 10px; } .dancer-onboarding-step-control { grid-column: 3; grid-row: 1; } }
      @media (max-width: 620px) { .dancer-profile-preview-overlay .profile-media-tabs { width:100%; } .dancer-profile-preview-overlay .profile-media-tabs button { padding-inline:9px; } .dancer-profile-preview-overlay .profile-media-grid { gap:4px; } .dancer-profile-preview-overlay .profile-media-viewer-previous, .dancer-profile-preview-overlay .profile-media-viewer-next { width:40px; height:50px; font-size:30px; } }
      @media (max-width: 620px) { .dancer-profile-editor-launch-card { grid-template-columns:1fr; padding:0; } .dancer-profile-editor-launch-button { width:100%; min-width:0; } .dancer-profile-editor-tools { margin-top:18px; padding:12px; border-radius:17px; } .dancer-profile-editor-footer { grid-template-columns:1fr; gap:8px; } .dancer-profile-editor-footer button { width:100%; min-width:0; } .dancer-profile-preview-overlay .live-actions { grid-template-columns:repeat(3,minmax(0,1fr)); } .dancer-profile-preview-overlay.is-editor .dancer-profile-preview-shell { padding-bottom:max(244px,calc(env(safe-area-inset-bottom) + 224px)); } .dancer-profile-builder-panel { bottom:calc(88px + env(safe-area-inset-bottom)); width:calc(100% - 16px); max-height:min(66dvh,620px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 104px - env(safe-area-inset-bottom))); padding-bottom:10px; border-bottom:1px solid rgba(126,234,255,.28); border-radius:20px; } .dancer-profile-preview-overlay.is-editor .dancer-profile-editor-footer { bottom:max(8px,env(safe-area-inset-bottom)); width:calc(100% - 16px); border-bottom:1px solid rgba(126,234,255,.2); border-radius:18px; } }
      @media (max-width: 620px) { .dancer-social-link-modal-backdrop { align-items:end; padding:10px max(10px,env(safe-area-inset-right)) max(10px,calc(92px + env(safe-area-inset-bottom))) max(10px,env(safe-area-inset-left)); } .dancer-profile-builder-panel.dancer-social-link-modal { inset:auto; left:auto; bottom:auto; width:100%; max-height:min(58dvh,360px,calc(100dvh - 118px - env(safe-area-inset-bottom))); padding:0; border-bottom:1px solid rgba(139,92,246,.34); border-radius:18px; transform:none; } .dancer-profile-builder-panel.dancer-social-link-modal > header { padding:12px 12px 10px; } .dancer-profile-builder-panel.dancer-social-link-modal > div { padding:12px; } .dancer-social-link-form input { min-height:48px; } }
      @media (max-width: 340px) { .dancer-profile-preview-overlay .venue-qr-unavailable { grid-template-columns:minmax(0,1fr) 112px; } .dancer-profile-preview-overlay .venue-qr-placeholder-icon { width:112px; min-width:112px; } }
      @media (max-width: 620px) { .dancer-step-one-workspace { padding-bottom: 28px; } .dancer-step-one-summary { grid-template-columns: 1fr; padding: 12px; } .dancer-step-one-summary > b { width: fit-content; } .dancer-step-one-checklist { grid-template-columns: 1fr; } .dancer-step-one-checklist button { min-height: 48px; grid-template-columns: 22px minmax(0,1fr); gap: 2px 7px; } .dancer-step-one-section-button { min-height: 72px; grid-template-columns: 30px minmax(0,1fr) 26px; gap: 7px; } .dancer-step-one-section-button em { grid-column: 2; width: fit-content; } .dancer-step-one-section-button i { grid-column: 3; grid-row: 1 / span 2; } .dancer-step-one-section-button small { white-space: normal; } .dancer-step-one-section-panel { padding: 6px; } .dancer-step-one-section-panel > .info-panel { padding: 10px; } .photo-source-grid { grid-template-columns: 1fr; } .dancer-step-one-section-panel .photo-upload-queue .photo-review-card { grid-template-columns: 72px minmax(0,1fr); gap: 10px; padding: 10px; } .dancer-step-one-section-panel .photo-upload-queue .photo-preview { width: 72px; } .dancer-step-one-section-panel .photo-review-list { grid-template-columns: repeat(2, minmax(0,1fr)); } .dancer-step-one-section-panel .photo-review-list .photo-review-card { min-height: 284px; gap: 8px; padding: 8px; } .dancer-step-one-section-panel .photo-review-list .photo-preview { width: 100%; } .dancer-step-one-section-panel .photo-delete-button { max-width: 100%; } .dancer-step-one-footer { grid-template-columns: 1fr; } .dancer-step-one-footer .dancer-onboarding-primary { width: 100%; } }
      @media (max-width: 620px) { .photo-upload-heading { align-items: flex-start; } .photo-source-action { min-height: 70px; } .photo-slot-summary { align-items: flex-start; flex-direction: column; gap: 2px; } .dancer-step-one-section-panel .photo-review-list { grid-template-columns: 1fr; } .dancer-step-one-section-panel .photo-review-list .photo-review-card { grid-template-columns: 92px minmax(0,1fr); align-items: start; min-height: 0; gap: 10px; padding: 10px; } .dancer-step-one-section-panel .photo-review-list .photo-preview { width: 92px; } }
      @media (max-width: 620px) { .shift-end-confirmation { grid-template-columns: 1fr; } .shift-end-confirmation > div { grid-template-columns: 1fr; } }
      @media (max-width: 620px) {
        .dashboard-shell-venue { padding-bottom: max(132px, calc(env(safe-area-inset-bottom) + 104px)); }
        .dashboard-shell-venue .dashboard-head { padding: 18px; border-radius: 20px; }
        .dashboard-shell-venue .dashboard-head h1 { font-size: clamp(30px,9vw,38px); }
        .venue-command-panel { gap: var(--mydancr-dashboard-gap); padding: 16px; }
        .venue-command-status { grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 11px; }
        .venue-refresh-control { grid-column: 1 / -1; width: 100%; display: flex; align-items: center; justify-content: space-between; }
        .venue-live-pill.is-inactive { font-size: 9px; }
        .venue-publication-panel { padding: 15px; }
        .venue-publication-actions { display: grid; grid-template-columns: 1fr; }
        .venue-publication-actions > button, .venue-publication-actions > a { width: 100%; min-height: 48px; }
        .venue-review-completion .venue-publication-actions { grid-template-columns: 1fr; gap: 10px; }
        .venue-review-package { padding: 12px; }
        .venue-review-package-heading { grid-template-columns: 60px minmax(0,1fr); gap: 11px; }
        .venue-review-logo { width: 60px; height: 60px; border-radius: 14px; }
        .venue-review-package dl > div { grid-template-columns: 1fr; gap: 4px; }
        .venue-workspace-tabs { gap: 3px; padding: 4px; border-radius: 14px; }
        .venue-workspace-tabs button { min-height: 76px; padding-inline: 5px; }
        .venue-workspace-tabs strong { font-size: 12px; }
        .venue-workspace-tabs small { font-size: 8px; }
        .venue-workspace-tab-status { font-size: 7.5px; }
        .venue-tonight-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .venue-tonight-metrics .metric:nth-child(odd) { border-left: 0; }
        .venue-tonight-metrics .metric:nth-child(n + 3) { border-top: 1px solid var(--mydancr-dashboard-border); }
        .venue-dashboard-metrics .metric { min-height: 62px; padding: 12px 10px; text-align: center; }
        .venue-dashboard-section > summary { min-height: 70px; padding: 14px; }
        .venue-referral-request-panel { grid-template-columns: 1fr; }
        .venue-referral-request-panel > button { width: 100%; }
        .venue-working-list a { align-items: flex-start; flex-direction: column; }
        .venue-working-verification { justify-items: start; text-align: left; padding-left: 58px; }
      }

      /* Compact profile editors share the social-link modal shell without duplicating editor logic. */
      .dancer-profile-editor-modal-backdrop { position:fixed; z-index:34; inset:0; display:grid; align-items:end; justify-items:center; padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); background:rgba(0,0,0,.66); backdrop-filter:blur(4px); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal { position:relative; z-index:1; inset:auto; left:auto; bottom:auto; width:min(100%,480px); max-height:min(82dvh,680px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 24px)); grid-template-rows:auto minmax(0,1fr) auto; padding:0; border:1px solid rgba(139,92,246,.34); border-radius:20px; background:linear-gradient(180deg,rgba(16,13,25,.995),rgba(7,7,11,.998)); box-shadow:0 24px 80px rgba(0,0,0,.68),0 0 30px rgba(124,58,237,.16); transform:none; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"],
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] { width:min(100%,680px); max-height:min(88dvh,760px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 24px)); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header { position:static; padding:14px 14px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:transparent; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header h2 { min-width:0; overflow-wrap:anywhere; font-size:clamp(19px,5vw,23px); line-height:1.1; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > header > button { width:42px; min-width:42px; height:42px; min-height:42px; flex:0 0 42px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal > .dancer-profile-editor-modal-body { overflow-x:hidden; overflow-y:auto; padding:14px; scroll-padding-bottom:18px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .info-panel { display:grid; gap:12px; overflow:visible; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
      .dancer-profile-editor-modal-actions { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(132px,190px); align-items:center; gap:12px; padding:12px 14px max(12px,env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); background:rgba(9,8,14,.96); }
      .dancer-profile-editor-modal-actions > p { margin:0; color:#fda4af; font-size:11px; line-height:1.35; }
      .dancer-profile-editor-modal-actions > button { width:100%; min-height:48px; border:1px solid rgba(196,181,253,.5); border-radius:13px; color:#fff; background:#7c3aed; box-shadow:0 0 18px rgba(124,58,237,.18); font:inherit; font-size:14px; font-weight:950; cursor:pointer; }
      .dancer-profile-editor-modal-actions > button:disabled { cursor:wait; opacity:.58; }
      body.dancr-button-system .dancer-profile-editor-modal-actions > button { min-height:48px !important; border-color:rgba(196,181,253,.5) !important; border-radius:13px !important; color:#fff !important; background:#7c3aed !important; box-shadow:0 0 18px rgba(124,58,237,.18) !important; }

      .dancer-profile-editor-intro { margin:0; color:#c5bdce !important; font-size:13px !important; line-height:1.4; }
      .dancer-profile-identity-editor .dancer-profile-identity-form { display:grid; grid-template-columns:1fr; gap:12px; }
      .dancer-profile-identity-editor .dancer-profile-identity-form > label { display:grid; gap:7px; color:#d9d4e1; font-size:12px; font-weight:900; line-height:1.2; }
      .dancer-profile-identity-editor .dancer-profile-identity-form input,
      .dancer-profile-identity-editor .dancer-profile-identity-form select { width:100%; min-width:0; min-height:50px; height:50px; box-sizing:border-box; padding:0 14px; border:1px solid rgba(148,163,184,.42); border-radius:13px; outline:none; color:#f8fafc; background:#111118; font:inherit; font-size:16px; }
      .dancer-profile-identity-editor .dancer-profile-identity-form input:focus,
      .dancer-profile-identity-editor .dancer-profile-identity-form select:focus { border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.2); }
      .dancer-profile-identity-editor .dancer-profile-identity-form label small { color:#9f97aa; font-size:11px; font-weight:700; line-height:1.35; }
      .dancer-profile-identity-editor .dancer-form-save-state { min-height:0; margin:0; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel { justify-items:center; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="avatar"] { height:min(540px,82dvh,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 24px)); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="avatar"] .dancer-profile-editor-modal-body { overflow-anchor:none; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel > * { width:100%; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-editor { position:relative; width:112px; display:grid; grid-template-columns:1fr; justify-items:center; gap:0; margin:2px auto; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-preview { width:108px; height:108px; font-size:36px; }
      .dancer-avatar-state { position:absolute; right:-7px; bottom:2px; width:auto !important; padding:5px 7px; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#f8fafc; background:#18171f; box-shadow:0 4px 14px rgba(0,0,0,.52); font-size:9px; font-weight:950; letter-spacing:.08em; line-height:1; text-transform:uppercase; }
      .dancer-avatar-state.is-approved { border-color:rgba(52,211,153,.4); color:#86efc0; background:#0e251d; }
      .dancer-avatar-state.is-checking, .dancer-avatar-state.is-pending { border-color:rgba(34,199,255,.4); color:#9aefff; background:#0b2027; }
      .dancer-avatar-state.is-rejected, .dancer-avatar-state.is-failed { border-color:rgba(251,113,133,.4); color:#fda4af; background:#30151d; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-upload-controls { display:grid; grid-template-columns:1fr; gap:10px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel > p[role="status"] { margin:0; color:#b9eff8; font-size:11px; line-height:1.4; text-align:center; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel[data-avatar-state="rejected"] > p[role="status"] { color:#fda4af; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .dancer-avatar-panel button { width:100%; min-height:42px; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-grid,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-grid { width:100% !important; max-width:100%; grid-template-columns:repeat(2,minmax(0,1fr)) !important; grid-auto-rows:1fr !important; justify-content:stretch; gap:10px; margin:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-action,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-action { width:100% !important; min-width:0 !important; max-width:none !important; height:auto !important; min-height:52px !important; max-height:none !important; display:grid !important; grid-template-columns:36px minmax(0,1fr) !important; align-items:center; justify-items:start; gap:9px !important; padding:8px 10px !important; border-radius:12px !important; text-align:left; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-icon,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-icon { width:36px; height:36px; border-radius:9px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-icon svg,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-icon svg { width:21px; height:21px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy { display:grid; gap:1px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy strong,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy strong { font-size:12px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-copy small,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-copy small { font-size:9px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal .photo-source-cta,
      .dancer-profile-builder-panel.dancer-profile-editor-modal .tv-video-source-cta { display:none; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .upload-panel { gap:12px; padding:0; border-radius:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .dancer-photo-upload-form { display:grid; grid-template-columns:1fr; align-items:stretch; justify-content:stretch; gap:10px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading { display:block; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading > span { display:block; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-heading strong { color:#c5bdce; font-size:13px; font-weight:750; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-primary-choice,
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-upload-status { grid-column:auto; }
      .upload-panel > .dancer-media-manager-title { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:3px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-media-manager-title strong { color:#fff; font-size:15px; }
      .dancer-media-manager-title span { color:#aaa2b5; font-size:11px; font-weight:800; }
      .photo-review-list.compact-photo-previews { min-width:0; display:flex; gap:10px; overflow-x:auto; margin:0; padding:2px 0 8px; }
      .compact-photo-previews .photo-saved-preview { flex:0 0 112px; min-width:0; display:grid; align-content:start; gap:4px; }
      .photo-saved-frame { position:relative; width:112px; aspect-ratio:3 / 4; display:grid; place-items:center; overflow:hidden; border:1px solid #40384b; border-radius:8px; background:#15101d; color:#c9c3d2; }
      .photo-saved-frame > img { width:100%; height:100%; display:block; object-fit:cover; }
      .photo-saved-preview > strong { color:#fff; font-size:12px; line-height:1.3; }
      .photo-saved-preview > small { color:#d4c3e9; font-size:11px; line-height:1.35; text-transform:none; letter-spacing:normal; }
      .photo-saved-preview.is-approved > small { color:#8ce4b2; }
      .photo-saved-frame .photo-card-remove-action, body.dancr-button-system .photo-saved-frame .photo-card-remove-action { position:absolute; right:1px; bottom:1px; z-index:1; display:grid; place-items:center; width:44px !important; height:44px !important; min-height:44px; margin:0; padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; color:#fff !important; cursor:pointer; }
      .photo-saved-frame .photo-card-remove-action > span { width:30px; height:30px; display:grid; place-items:center; justify-self:end; border:1px solid rgba(255,255,255,.4); border-radius:50%; background:rgba(0,0,0,.78); box-shadow:0 1px 5px rgba(0,0,0,.35); }
      .photo-saved-frame .photo-card-remove-action svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .photo-saved-frame .photo-card-remove-action:disabled { opacity:.55; cursor:wait; }
      .photo-saved-frame .photo-card-remove-action:focus-visible { outline:2px solid #fff; outline-offset:-2px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"] .photo-card-actions { gap:5px !important; }

      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded { overflow:visible; padding:0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded-head { display:block; margin:0 0 12px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-studio-embedded-head p { margin:0; color:#c5bdce; font-size:13px; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-form { display:grid; grid-template-columns:1fr; gap:10px; overflow:visible; padding:0; border:0; border-radius:0; background:transparent; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-form > * { grid-column:auto !important; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-permissions strong { font-size:13px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-check { min-height:0; grid-template-columns:20px minmax(0,1fr) !important; align-items:start; gap:9px; padding:10px; border:1px solid rgba(255,255,255,.09); border-radius:11px; background:rgba(255,255,255,.035); font-size:12px; font-weight:700; letter-spacing:normal; line-height:1.45; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-check input { width:18px; height:18px; margin:1px 0 0; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-upload-requirements { color:#9f97aa; font-size:10px; font-weight:700; line-height:1.4; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-video-manager { margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,.08); }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-manager-title h3 { font-size:15px; }
      .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] .tv-manager-title span { min-height:0; padding:0; color:#aaa2b5; background:transparent; font-size:11px; }

      @media (max-width:620px) {
        .dancer-profile-editor-modal-backdrop { align-items:end; padding:8px max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); }
        .dancer-profile-builder-panel.dancer-profile-editor-modal,
        .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="photos"],
        .dancer-profile-builder-panel.dancer-profile-editor-modal[data-section="videos"] { inset:auto; left:auto; bottom:auto; width:100%; max-height:min(88dvh,720px,calc(100dvh - var(--mydancr-preview-banner-offset,0px) - 16px)); padding:0; border-bottom:1px solid rgba(139,92,246,.34); border-radius:18px; transform:none; }
        .dancer-profile-builder-panel.dancer-profile-editor-modal > header { padding:12px 12px 10px; }
        .dancer-profile-builder-panel.dancer-profile-editor-modal > .dancer-profile-editor-modal-body { padding:12px; }
        .dancer-profile-editor-modal-actions { grid-template-columns:1fr; gap:7px; padding:10px 12px max(10px,env(safe-area-inset-bottom)); }
        .dancer-profile-editor-modal-actions > span:empty { display:none; }
      }
    `}</style>
  );
}
