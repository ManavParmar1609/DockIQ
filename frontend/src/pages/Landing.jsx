import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/Shared';
import { ChevronRight, ArrowRight, Zap, Shield, BarChart3, Brain, Clock, Truck, CheckCircle, AlertTriangle } from 'lucide-react';

function useScrollReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );
    const el = ref.current;
    if (el) el.querySelectorAll('.reveal').forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, []);
  return ref;
}

export default function Landing() {
  const navigate = useNavigate();
  const pageRef = useScrollReveal();

  return (
    <div ref={pageRef} className="bg-white">
      {/* ═══ STICKY NAV ═══ */}
      <nav className="landing-nav fixed top-0 left-0 right-0 z-50">
        <div className="max-w-[980px] mx-auto px-6 h-12 flex items-center justify-between">
          <BrandMark compact />
          <div className="flex items-center gap-6">
            <a href="#features" className="text-xs text-gray-600 hover:text-gray-900 transition-colors hidden sm:block">Features</a>
            <a href="#how-it-works" className="text-xs text-gray-600 hover:text-gray-900 transition-colors hidden sm:block">How It Works</a>
            <a href="#impact" className="text-xs text-gray-600 hover:text-gray-900 transition-colors hidden sm:block">Impact</a>
            <button
              onClick={() => navigate('/login')}
              className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-full hover:bg-blue-700 transition-colors"
            >
              Launch App
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 pt-12 relative">
        <div className="absolute inset-0 grid-bg pointer-events-none" />
        <div className="relative z-10">
          <p className="reveal text-blue-600 text-sm font-semibold tracking-wide uppercase mb-4">Dock-Door Intelligence</p>
          <h1 className="reveal reveal-delay-1 hero-headline max-w-4xl mx-auto">
            DockIQ
          </h1>
          <p className="reveal reveal-delay-2 hero-sub max-w-2xl mx-auto mt-4">
            AI-powered resolution. Real-time visibility.<br />
            Every dock door, every shift.
          </p>
          <div className="reveal reveal-delay-3 flex flex-wrap items-center justify-center gap-4 mt-10">
            <button
              onClick={() => navigate('/login')}
              className="pill-cta pill-cta-primary"
            >
              Explore the Platform <ChevronRight size={18} />
            </button>
            <a href="#features" className="pill-cta pill-cta-secondary">
              Learn more <ChevronRight size={16} />
            </a>
          </div>
        </div>

        {/* Hero visual — floating dock mockup */}
        <div className="reveal reveal-delay-4 mt-16 mb-8 w-full max-w-5xl mx-auto relative">
          <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/10 border border-black/[0.06]">
            {/* Mock app header */}
            <div className="bg-stone-50 px-4 py-3 flex items-center gap-2 border-b border-black/[0.06]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-gray-500">DockIQ.AI — Worker Dashboard</span>
              </div>
            </div>
            {/* Mock dashboard content */}
            <div className="bg-white p-8">
              <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Active Docks', value: '8', color: 'bg-blue-50 text-blue-600' },
                  { label: 'Issues Today', value: '3', color: 'bg-amber-50 text-amber-600' },
                  { label: 'Self-Resolved', value: '67%', color: 'bg-emerald-50 text-emerald-600' },
                  { label: 'Avg Resolution', value: '4.2m', color: 'bg-purple-50 text-purple-600' },
                ].map((s, i) => (
                  <div key={i} className={`${s.color} rounded-2xl p-5`}>
                    <p className="text-xs font-medium opacity-70">{s.label}</p>
                    <p className="text-3xl font-bold mt-1">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 bg-stone-50 rounded-2xl p-5">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Priority Alert Queue</p>
                  {['CRITICAL — Dock 5 — Temp deviation 28°F', 'HIGH — Dock 12 — Damaged pallet', 'MEDIUM — Dock 18 — Count shortage'].map((a, i) => (
                    <div key={i} className="bg-white rounded-xl p-3 mb-2 text-xs text-gray-600 shadow-sm">{a}</div>
                  ))}
                </div>
                <div className="bg-stone-50 rounded-2xl p-5">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Dock Floor</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[1,2,3,4,5,6,7,8,9].map(d => (
                      <div key={d} className={`rounded-lg p-2 text-center text-xs font-bold ${
                        d === 5 ? 'bg-red-100 text-red-600' : d === 12 || d === 3 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>{d}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS RIBBON ═══ */}
      <section className="py-20 border-t border-b border-black/[0.06] bg-stone-50">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '75%', label: 'Reduction in supervisor interruptions' },
            { value: '4 min', label: 'Average issue resolution time' },
            { value: '100%', label: 'Digital discrepancy capture' },
            { value: '$14K', label: 'Monthly cost impact visibility' },
          ].map((s, i) => (
            <div key={i} className="reveal" style={{ transitionDelay: `${i * 0.1}s` }}>
              <p className="stat-number text-gray-900">{s.value}</p>
              <p className="text-sm text-gray-500 mt-2 max-w-[180px] mx-auto">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FEATURE: AI RESOLUTION ═══ */}
      <section id="features" className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal section-eyebrow">AI-Powered Resolution</p>
            <h2 className="reveal reveal-delay-1 section-headline mt-2">Resolution before<br />escalation.</h2>
            <p className="reveal reveal-delay-2 section-copy max-w-2xl mx-auto mt-4">
              When an operator encounters an issue, DockIQ searches company procedures, customer SOPs, 
              and past resolutions to provide step-by-step guidance — instantly.
            </p>
          </div>

          <div className="reveal reveal-delay-3 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left — Resolution flow */}
            <div className="feature-card bg-stone-50 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center">
                  <Brain size={20} className="text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">RAG-Based Knowledge</p>
                  <p className="text-xs text-gray-500">30+ resolution procedures</p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { step: '1', text: 'Worker selects issue type', sub: 'One tap — context auto-filled' },
                  { step: '2', text: 'AI searches knowledge base', sub: 'SOPs, procedures, past resolutions' },
                  { step: '3', text: 'Step-by-step guidance shown', sub: 'With confidence score and source' },
                  { step: '4', text: 'Self-resolve or escalate', sub: 'Supervisor gets full context if needed' },
                ].map((s, i) => (
                  <div key={i} className="flex gap-3 items-start bg-white rounded-xl p-3">
                    <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.step}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.text}</p>
                      <p className="text-xs text-gray-500">{s.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Severity classifier */}
            <div className="feature-card bg-black text-white p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
                  <Zap size={20} className="text-white" />
                </div>
                <div>
                  <p className="font-semibold">Dynamic Severity Classifier</p>
                  <p className="text-xs text-white/50">Weighted AI scoring engine</p>
                </div>
              </div>
              <div className="font-mono text-xs leading-relaxed text-white/70 bg-white/5 rounded-xl p-4">
                <p className="text-white/40 mb-2">// severity_engine.score()</p>
                <p><span className="text-blue-400">issue_type</span> = "Temperature Deviation" <span className="text-white/30">→ ×5</span></p>
                <p><span className="text-emerald-400">product</span> = "Frozen Salmon" <span className="text-white/30">→ ×3.0</span></p>
                <p><span className="text-amber-400">customer</span> = "Bulkhaven Club (Tier 1)" <span className="text-white/30">→ ×1.5</span></p>
                <p><span className="text-red-400">temp_delta</span> = 28°F above threshold <span className="text-white/30">→ +5</span></p>
                <p className="mt-3 text-white border-t border-white/10 pt-3">
                  score = <span className="text-red-400 font-bold text-lg">27.5</span> → <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full text-xs">CRITICAL</span>
                </p>
              </div>
              <p className="text-xs text-white/40 mt-4">Every classification includes transparent reasoning — supervisors see exactly why.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURE: REAL-TIME ═══ */}
      <section id="how-it-works" className="dark-section py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal section-eyebrow">Real-Time Operations</p>
            <h2 className="reveal reveal-delay-1 section-headline-light mt-2">Every second counts.<br />Now you can see them all.</h2>
            <p className="reveal reveal-delay-2 section-copy-light max-w-2xl mx-auto mt-4">
              Live dock floor status, priority-sorted alert queues, instant escalation 
              with full context. No more walk-or-radio.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Shield, title: 'Priority Triage', desc: 'Critical issues surface first. Temperature emergencies don\'t wait behind barcode questions.', accent: 'bg-red-500' },
              { icon: Clock, title: 'Escalation Timer', desc: 'Unacknowledged issues auto-upgrade severity. No alert goes ignored.', accent: 'bg-amber-500' },
              { icon: Truck, title: 'Dock Lifecycle', desc: 'Track every phase: arrival → inspection → active → complete → departed.', accent: 'bg-emerald-500' },
            ].map((f, i) => (
              <div key={i} className="reveal feature-card bg-white/[0.04] border border-white/[0.06] p-7" style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className={`w-10 h-10 rounded-2xl ${f.accent} flex items-center justify-center mb-5`}>
                  <f.icon size={20} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURE: TWO PORTALS ═══ */}
      <section className="py-28 px-6 bg-stone-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal section-eyebrow">Two Portals. One Platform.</p>
            <h2 className="reveal reveal-delay-1 section-headline mt-2">Built for the dock floor.<br />Built for the office.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Worker */}
            <div className="reveal feature-card bg-white p-8 shadow-lg shadow-black/[0.04]">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center mb-5">
                <Truck size={24} className="text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Worker Portal</h3>
              <p className="text-sm text-gray-500 mb-6">Everything an operator needs, at the dock door. Minimum typing, maximum guidance.</p>
              <div className="space-y-3">
                {[
                  'Visual load patterns per customer',
                  'One-tap issue reporting with quick-tag chips',
                  'AI chat for instant procedural guidance',
                  'Temperature auto-evaluation',
                  'SKU scan verification with mismatch alerts',
                  'Tap counter — no more losing count',
                  'Load completion sign-off with seal tracking',
                ].map((f, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <CheckCircle size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-600">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Supervisor */}
            <div className="reveal reveal-delay-1 feature-card bg-white p-8 shadow-lg shadow-black/[0.04]">
              <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center mb-5">
                <Shield size={24} className="text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Supervisor Portal</h3>
              <p className="text-sm text-gray-500 mb-6">Oversight without micromanagement. See everything, act on what matters.</p>
              <div className="space-y-3">
                {[
                  'Severity-sorted priority alert queue',
                  'Live dock floor status map',
                  'Full issue context + what AI recommended',
                  'Searchable issue logs with filters',
                  'Analytics: by dock, operator, customer, carrier',
                  'Shift handoff notes with auto-listed unresolved issues',
                  'Broadcast messages to all worker tablets',
                ].map((f, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <CheckCircle size={16} className="text-gray-900 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-600">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURE: ANALYTICS ═══ */}
      <section id="impact" className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal section-eyebrow">Operational Intelligence</p>
            <h2 className="reveal reveal-delay-1 section-headline mt-2">See the patterns.<br />Fix the problems.</h2>
            <p className="reveal reveal-delay-2 section-copy max-w-2xl mx-auto mt-4">
              Every issue logged — self-resolved or escalated — feeds into a growing operational record. 
              Spot recurring failures, track carrier quality, identify training opportunities.
            </p>
          </div>

          <div className="reveal reveal-delay-3 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: BarChart3, title: 'Issues by Type', desc: 'What breaks most?' },
              { icon: AlertTriangle, title: 'Recurring Patterns', desc: 'Auto-detected 3+ in 7 days' },
              { icon: Truck, title: 'Carrier Scorecard', desc: 'Track quality by carrier' },
              { icon: Clock, title: 'Resolution Time', desc: 'Avg time by severity' },
            ].map((f, i) => (
              <div key={i} className="bg-stone-50 rounded-2xl p-6 text-center hover:bg-[#e8e8ed] transition-colors">
                <f.icon size={28} className="text-blue-600 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-900">{f.title}</p>
                <p className="text-xs text-gray-500 mt-1">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ BOTTOM CTA ═══ */}
      <section className="dark-section py-32 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="reveal section-headline-light">Ready to see it<br />in action?</h2>
          <p className="reveal reveal-delay-1 section-copy-light mt-4 max-w-xl mx-auto">
            DockIQ is a fully working prototype. Log in as a worker or supervisor 
            and explore every feature — with real synthetic data.
          </p>
          <div className="reveal reveal-delay-2 flex flex-wrap items-center justify-center gap-4 mt-10">
            <button
              onClick={() => navigate('/login')}
              className="pill-cta pill-cta-primary text-lg px-8 py-4"
            >
              Launch the Platform <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-black/[0.06] py-6 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <p className="text-xs text-gray-500">© 2026 DockIQ.AI. All rights reserved.</p>
          <p className="text-xs text-gray-500">Prototype Demo · Prepared by Rishabh Gupta</p>
        </div>
      </footer>
    </div>
  );
}
