import React, { useState, useEffect } from 'react';
import { User, UserRole } from './types';
import { Layout } from './components/Layout';
import { AuthView } from './views/AuthView';
import { HomeView } from './views/HomeView';
import { StudentsView } from './views/StudentsView';
import { CompetitionView } from './views/CompetitionView';
import { ReportsView } from './views/ReportsView';
import { SystemSettingsView } from './views/SystemSettingsView';
import {
  fetchBehaviorRulesFromGoogleSheet,
  fetchManagersFromGoogleSheet,
  prewarmGoogleScriptConnection
} from './services/dataService';

const createDefaultGuestUser = (): User => ({
  phone: 'guest',
  name: 'Người dùng',
  className: '',
  role: UserRole.STUDENT,
  totalScore: 0,
  examHistory: [],
  isGuest: true
});

const isUserTeacherOrAdmin = (u: any): boolean => {
  if (!u) return false;
  if (u.role === UserRole.ADMIN) return true;
  const phone = (u.phone || '').toString().trim().replace(/^0+/, '');
  if (phone === '966000224' || u.phone === '0966000224') return true;
  const name = (u.name || '').toString().toLowerCase();
  if (name.includes('admin') || name.includes('quản trị') || name.includes('quan tri') || name.includes('giáo viên') || name.includes('giao vien') || name.includes('thầy') || name.includes('hiển')) return true;
  const cls = (u.className || '').toString().toLowerCase();
  if (cls.includes('admin') || cls.includes('giáo viên') || cls.includes('giao vien')) return true;
  return false;
};

const getInitialUser = (): User => {
  try {
    const session = localStorage.getItem('current_user_phone');
    if (session) {
      if (session === 'guest') {
        const guestData = localStorage.getItem('user_guest');
        if (guestData) {
          const parsed = JSON.parse(guestData);
          if (isUserTeacherOrAdmin(parsed)) parsed.role = UserRole.ADMIN;
          return parsed;
        }
      } else {
        const userData = localStorage.getItem(`user_${session}`);
        if (userData) {
          const parsed = JSON.parse(userData);
          if (isUserTeacherOrAdmin(parsed)) parsed.role = UserRole.ADMIN;
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error('Error loading session:', err);
  }
  return createDefaultGuestUser();
};

const navItems = [
  { id: 'home', label: 'Trang Chủ', icon: '🏠' },
  { id: 'students', label: 'Học Sinh', icon: '👥' },
  { id: 'competition', label: 'Thi Đua', icon: '🏆' },
  { id: 'reports', label: 'Báo Cáo', icon: '📊' },
  { id: 'settings', label: 'Hệ Thống', icon: '⚙️' },
];

const App: React.FC = () => {
  const [user, setUser] = useState<User>(getInitialUser);
  const [activeTab, setActiveTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number>(() => {
    const saved = Number(localStorage.getItem('app_selected_week'));
    return saved >= 1 && saved <= 35 ? saved : 1;
  });

  const handleWeekChange = (week: number) => {
    setSelectedWeek(week);
    localStorage.setItem('app_selected_week', String(week));
    window.dispatchEvent(new CustomEvent('app_data_updated', { detail: { selectedWeek: week } }));
  };

  const handleGlobalSync = async (targetUser?: User) => {
    const currentUser = targetUser || user;
    // 1. Gửi sự kiện cập nhật dữ liệu tới các thẻ (Học Sinh, Thi Đua...)
    window.dispatchEvent(new CustomEvent('app_sync_google', { detail: { user: currentUser } }));

    // Đồng bộ danh mục hành vi thi đua từ Sheet 04_THI_DUA (đã gộp yêu cầu trùng lặp)
    fetchBehaviorRulesFromGoogleSheet(false).catch(() => {});

    // 2. Làm mới thông tin chức vụ/tên của tài khoản hiện tại từ Google Sheet (Sheet 01)
    if (!currentUser.isGuest && currentUser.phone) {
      try {
        const cleanPhone = currentUser.phone.replace(/[\s.-]/g, '');
        const managers = await fetchManagersFromGoogleSheet(false);
        if (Array.isArray(managers) && managers.length > 0) {
          const found = managers.find(
            (m: any) => String(m.phone || '').replace(/^0+/, '') === cleanPhone.replace(/^0+/, '')
          );
          if (found) {
            const roleRaw = String(found.role || '').trim().toUpperCase();
            let resolvedScope = String(found.managedScope || currentUser.managedScope || '').trim();
            const combined = `${roleRaw} ${resolvedScope} ${found.note || ''}`.toLowerCase();
            const isAdminRole = roleRaw === 'GVCN' || roleRaw === 'ADMIN';
            if (!isAdminRole && !combined.includes('lớp trưởng') && !combined.includes('lop_truong')) {
              if (combined.includes('1')) resolvedScope = 'Tổ 1';
              else if (combined.includes('2')) resolvedScope = 'Tổ 2';
              else if (combined.includes('3')) resolvedScope = 'Tổ 3';
              else if (combined.includes('4')) resolvedScope = 'Tổ 4';
            }

            const updatedUser: User = {
              ...currentUser,
              name: found.name || currentUser.name,
              className: found.className || currentUser.className,
              role: isAdminRole ? UserRole.ADMIN : currentUser.role,
              rawRole: roleRaw || currentUser.rawRole,
              managedScope: resolvedScope || currentUser.managedScope
            };
            setUser(updatedUser);
            localStorage.setItem(`user_${updatedUser.phone}`, JSON.stringify(updatedUser));
          }
        }
      } catch (e) {
        console.warn('Lỗi làm mới hồ sơ cán sự:', e);
      }
    } else {
      // Làm ấm kết nối và nạp sẵn danh sách cán sự cho khách để khi bấm Đăng nhập phản hồi tức thì
      prewarmGoogleScriptConnection();
    }
  };

  const handleLogin = (u: User) => {
    localStorage.setItem('current_user_phone', u.phone);
    localStorage.setItem(`user_${u.phone}`, JSON.stringify(u));
    setUser(u);
    setShowAuthModal(false);

    // Kích hoạt đồng bộ ngay lập tức (0ms delay) sau khi đăng nhập
    handleGlobalSync(u);
  };

  // Tự động đồng bộ 2 chiều ngay khi tải ứng dụng cho mọi phiên làm việc
  useEffect(() => {
    handleGlobalSync(user);

    const handleNavigateStudent = (e: any) => {
      const targetTab = e?.detail?.tab;
      if (targetTab) {
        setActiveTab(targetTab);
      }
      if (e?.detail?.week) {
        setSelectedWeek(Number(e.detail.week));
      }
    };

    window.addEventListener('app_navigate_student', handleNavigateStudent);
    return () => {
      window.removeEventListener('app_navigate_student', handleNavigateStudent);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('current_user_phone');
    setUser(createDefaultGuestUser());
    if (activeTab === 'settings') {
      setActiveTab('home');
    }
  };

  const canAccessSystemTab = !user.isGuest && isUserTeacherOrAdmin(user);

  const visibleNavItems = canAccessSystemTab
    ? navItems
    : navItems.filter(item => item.id !== 'settings');

  useEffect(() => {
    if (!canAccessSystemTab && activeTab === 'settings') {
      setActiveTab('home');
    }
  }, [canAccessSystemTab, activeTab]);

  const handleTabChange = (tab: string) => {
    if (tab === 'settings' && !canAccessSystemTab) return;
    setActiveTab(tab);
  };

  return (
    <>
      <Layout 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        user={user} 
        onLogout={handleLogout}
        onOpenLogin={() => setShowAuthModal(true)}
        navItems={visibleNavItems}
        appTitle="Quản Lí Lớp Chủ Nhiệm"
        onSyncGoogle={handleGlobalSync}
        selectedWeek={selectedWeek}
        onWeekChange={handleWeekChange}
      >
        {/* Thẻ Trang Chủ hiển thị 5 thẻ tổng quan theo đúng mẫu yêu cầu */}
        <div className={activeTab === 'home' ? 'block' : 'hidden'}>
          <HomeView user={user} selectedWeek={selectedWeek} />
        </div>

        {/* Thẻ Học Sinh giữ nguyên trạng thái trong bộ nhớ, chuyển tab tức thì 0 giây */}
        <div className={activeTab === 'students' ? 'block' : 'hidden'}>
          <StudentsView user={user} />
        </div>

        {/* Thẻ Thi Đua giữ nguyên trạng thái trong bộ nhớ, đồng bộ số liệu thực từ Sheet 02, 03, 04 */}
        <div className={activeTab === 'competition' ? 'block' : 'hidden'}>
          <CompetitionView user={user} selectedWeek={selectedWeek} onWeekChange={handleWeekChange} />
        </div>

        {/* Thẻ Báo Cáo: Xem trước & Tải xuống Excel (.xlsx) theo Tuần, Tổ, Học kì 1, Học kì 2, Cả năm */}
        <div className={activeTab === 'reports' ? 'block' : 'hidden'}>
          <ReportsView user={user} selectedWeek={selectedWeek} onWeekChange={handleWeekChange} />
        </div>

        {/* Thẻ Hệ Thống: Chỉ hiện cho Admin cao cấp & GVCN */}
        {canAccessSystemTab && (
          <div className={activeTab === 'settings' ? 'block' : 'hidden'}>
            <SystemSettingsView user={user} onSyncGoogle={handleGlobalSync} />
          </div>
        )}
      </Layout>

      {/* Login modal (tùy chọn khi bấm Đăng nhập) */}
      {showAuthModal && (
        <AuthView 
          onLoginSuccess={handleLogin} 
          onClose={() => setShowAuthModal(false)}
          isModal={true}
        />
      )}
    </>
  );
};

export default App;
