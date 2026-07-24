import { NavLink } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useIssueSummary } from '../hooks/useIssueSummary';
import { navForRole, type NavItem } from './navigation';

function SidebarLink({ item, onNavigate, badge }: { item: NavItem; onNavigate?: () => void; badge?: number }) {
  const Icon = item.icon;
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/app/dashboard'}
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
      <span className="flex-1">{item.label}</span>
      {showBadge ? (
        <span
          className="inline-flex min-w-[1.4rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold leading-none text-white"
          aria-label={`${badge} sự cố chưa xử lý`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const nav = navForRole(user?.role);
  // Unresolved-issue badge on the "Sự cố khách sạn" / "Báo cáo sự cố" menu item.
  const summary = useIssueSummary(!!user);
  const unresolved = summary.data?.summary.totalUnresolved ?? 0;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">Kas</p>
          <p className="text-xs text-slate-500">Điều phối đặt phòng</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Điều hướng chính">
        {nav.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            onNavigate={onNavigate}
            badge={item.to === '/app/issues' ? unresolved : undefined}
          />
        ))}
      </nav>

      {user?.branch ? (
        <div className="border-t border-slate-200 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Chi nhánh</p>
          <p className="mt-1 text-sm font-medium text-slate-700">{user.branch.hotelName}</p>
          <p className="text-xs text-slate-500">{user.branch.address}</p>
        </div>
      ) : null}
    </aside>
  );
}
