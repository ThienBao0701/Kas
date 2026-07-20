import { NavLink } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from './navigation';

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">Hotel Booking</p>
          <p className="text-xs text-slate-500">Dispatch</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Điều hướng chính">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}

        {isAdmin ? (
          <div className="pt-4">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Quản trị
            </p>
            <div className="space-y-1">
              {ADMIN_NAV.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ) : null}
      </nav>
    </aside>
  );
}
