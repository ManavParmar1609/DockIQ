import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useState, useEffect } from 'react';
import { BrandMark } from '../../components/Shared';
import { LayoutDashboard, FileText, BarChart3, ArrowLeftRight, LogOut, MessageSquare } from 'lucide-react';

export default function SupervisorLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState(0);

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'issue_escalated' || msg.type === 'new_issue') {
        setAlerts(a => a + 1);
      }
    };
    return () => ws.close();
  }, []);

  const links = [
    { to: '/app', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/app/logs', icon: FileText, label: 'Issue Logs' },
    { to: '/app/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/app/chat', icon: MessageSquare, label: 'AI Chat' },
    { to: '/app/handoff', icon: ArrowLeftRight, label: 'Shift Handoff' },
  ];

  return (
    <div className="apple-shell flex h-screen">
      <aside className="apple-sidebar hidden md:flex w-64 border-r flex-col flex-shrink-0">
        <div className="p-5 border-b border-gray-200">
          <BrandMark subtitle="Supervisor operations" />
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `apple-nav-link flex items-center gap-3 px-3 py-2.5 text-sm font-medium ${
                  isActive ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <l.icon size={18} />
              {l.label}
              {l.label === 'Dashboard' && alerts > 0 && (
                <span className="ml-auto w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold text-white animate-pulse">{alerts}</span>
              )}
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
              <p className="text-xs text-gray-500">{user.employee_id} · {user.zone}</p>
            </div>
            <button onClick={() => { logout(); navigate('/'); }} className="text-gray-500 hover:text-red-600"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {/* Mobile top bar */}
        <div className="apple-mobile-bar md:hidden flex items-center justify-between px-4 py-2 border-b">
          <BrandMark compact subtitle="Supervisor" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{user.name}</span>
            <button onClick={() => { logout(); navigate('/'); }} className="text-gray-500 hover:text-red-600">
              <LogOut size={14} />
            </button>
          </div>
        </div>
        <div className="apple-content p-4 sm:p-6">
          {children}
        </div>
      </main>

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
