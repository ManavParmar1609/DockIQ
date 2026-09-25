import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useState, useEffect } from 'react';
import { api, wsUrl } from '../../api';
import { BrandMark } from '../../components/Shared';
import { LayoutDashboard, PackageOpen, PackageCheck, MessageSquare, AlertTriangle, LogOut, ClipboardList, Megaphone, Wrench, X, Battery, ScanLine, Package, CheckCircle2 } from 'lucide-react';

const REQUEST_TYPES = [
  { value: 'Equipment Swap — Scanner', icon: ScanLine, color: 'text-blue-500 bg-blue-50' },
  { value: 'Equipment Swap — Forklift Battery', icon: Battery, color: 'text-amber-500 bg-amber-50' },
  { value: 'Supplies — Pallet Wrap', icon: Package, color: 'text-emerald-500 bg-emerald-50' },
  { value: 'Supplies — Slip Sheets', icon: Package, color: 'text-purple-500 bg-purple-50' },
  { value: 'Dock Plate Adjustment', icon: Wrench, color: 'text-orange-500 bg-orange-50' },
  { value: 'Cleanup Needed', icon: Wrench, color: 'text-red-500 bg-red-50' },
];

export default function WorkerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [broadcasts, setBroadcasts] = useState([]);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showRequestPanel, setShowRequestPanel] = useState(false);
  const [requestSent, setRequestSent] = useState(null);

  useEffect(() => {
    api.getBroadcasts().then(b => {
      if (b.length > 0) {
        setBroadcasts(b);
        setShowBroadcast(true);
        // Auto-dismiss after 30 seconds
        setTimeout(() => setShowBroadcast(false), 30000);
      }
    });
    // WebSocket for real-time
    const ws = new WebSocket(wsUrl());
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'broadcast') {
        setBroadcasts(prev => [{ message: msg.message, created_at: new Date().toISOString() }, ...prev]);
        setShowBroadcast(true);
        setTimeout(() => setShowBroadcast(false), 30000);
      }
    };
    return () => ws.close();
  }, []);

  const links = [
    { to: '/app', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/app/inspection', icon: ClipboardList, label: 'Inspection' },
    { to: '/app/loading', icon: PackageCheck, label: 'Loading' },
    { to: '/app/unloading', icon: PackageOpen, label: 'Unloading' },
    { to: '/app/chat', icon: MessageSquare, label: 'AI Chat' },
    { to: '/app/my-issues', icon: AlertTriangle, label: 'My Issues' },
  ];

  return (
    <div className="apple-shell flex h-screen">
      {/* Sidebar — hidden on mobile, shown on md+ */}
      <aside className="apple-sidebar hidden md:flex w-64 border-r flex-col flex-shrink-0">
        <div className="p-5 border-b border-gray-200">
          <BrandMark subtitle="Worker operations" />
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `apple-nav-link flex items-center gap-3 px-3 py-2.5 text-sm font-medium ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <l.icon className="w-4.5 h-4.5" size={18} />
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
              {user.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
              <p className="text-xs text-gray-500">{user.employee_id}</p>
            </div>
            <button onClick={() => { logout(); navigate('/'); }} className="text-gray-500 hover:text-red-600 transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {/* Mobile top bar */}
        <div className="apple-mobile-bar md:hidden flex items-center justify-between px-4 py-2 border-b">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{user.name}</span>
            <button onClick={() => { logout(); navigate('/'); }} className="text-gray-500 hover:text-red-600">
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* Broadcast banner */}
        {showBroadcast && broadcasts.length > 0 && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-5 py-2.5 flex items-center justify-between animate-slide-in">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-amber-600" />
              <span className="text-amber-600 text-xs sm:text-sm font-medium">{broadcasts[0].message}</span>
            </div>
            <button onClick={() => setShowBroadcast(false)} className="text-amber-500 hover:text-amber-700 text-xs">✕</button>
          </div>
        )}
        <div className="apple-content p-4 sm:p-6">
          {children}
        </div>
      </main>

      {/* Quick Request Floating Button */}
      <button
        onClick={() => { setShowRequestPanel(true); setRequestSent(null); }}
        className="apple-fab hidden md:flex fixed bottom-6 right-6 w-14 h-14 items-center justify-center text-white z-40"
        title="Quick Request"
      >
        <Wrench size={22} />
      </button>

      {/* Quick Request Panel */}
      {showRequestPanel && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRequestPanel(false)}>
          <div className="apple-sheet bg-white max-w-sm w-full p-6 animate-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Quick Request</h3>
                <p className="text-xs text-gray-400">Need equipment or supplies? Tap to request.</p>
              </div>
              <button onClick={() => setShowRequestPanel(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            {requestSent ? (
              <div className="text-center py-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                <p className="text-lg font-semibold text-gray-900">Request Sent</p>
                <p className="text-sm text-gray-400 mt-1">{requestSent}</p>
                <p className="text-xs text-gray-400 mt-3">Someone will be on it shortly.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {REQUEST_TYPES.map(rt => (
                  <button
                    key={rt.value}
                    onClick={async () => {
                      await api.createRequest({ operator_id: user.id, request_type: rt.value });
                      setRequestSent(rt.value);
                    }}
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-all group"
                  >
                    <div className={`w-10 h-10 rounded-xl ${rt.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <rt.icon size={18} />
                    </div>
                    <span className="text-xs font-medium text-gray-600 text-center leading-tight">{rt.value.replace('Equipment Swap — ', '').replace('Supplies — ', '')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="apple-tabbar md:hidden fixed bottom-0 left-0 right-0 border-t flex justify-around py-2 z-50">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            <l.icon size={18} />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
