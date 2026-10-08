import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { fetchStudentsFromGoogleSheet, deduplicateStudentsById } from '../services/dataService';

export interface StudentItem {
  id: string;
  className: string;
  name: string;
  gender: string;
  birthDate: string;
  group: string;
  phone: string;
  status: string;
  note: string;
}

const getCachedStudents = (cls: string): StudentItem[] => {
  try {
    const raw = localStorage.getItem('cached_students_all') || localStorage.getItem(`cached_students_${cls || '12T7'}`) || localStorage.getItem('cached_students_10T6');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return deduplicateStudentsById(parsed);
    }
  } catch {}
  return [];
};

interface StudentsViewProps {
  user: User;
}

export const StudentsView: React.FC<StudentsViewProps> = ({ user }) => {
  const currentClass = user.className || '12T7';
  // Khởi tạo ngay lập tức từ bộ nhớ đệm (Cache) để hiển thị 0 giây, không phải chờ tải lại
  const [students, setStudents] = useState<StudentItem[]>(() => getCachedStudents(currentClass));
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Mặc định: Nếu là Tổ trưởng thì vào đúng tổ đó, ngược lại mặc định "Tất cả"
  const getInitialGroup = () => {
    if (user.managedScope && user.managedScope.includes('Tổ')) {
      return user.managedScope.trim();
    }
    return 'Tất cả';
  };
  const [selectedGroup, setSelectedGroup] = useState<string>(getInitialGroup);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    return localStorage.getItem('cached_sync_time_all') || localStorage.getItem(`cached_sync_time_${currentClass}`) || '';
  });

  // Thứ tự các nút lọc Tổ theo đúng yêu cầu của Thầy/Cô: Tổ 1, Tổ 2, Tổ 3, Tổ 4, Tất Cả
  const groupFilters = ['Tổ 1', 'Tổ 2', 'Tổ 3', 'Tổ 4', 'Tất cả'];

  const fetchStudents = async (forceShowLoading = false) => {
    // Chỉ hiện vòng xoay tải nếu chưa hề có dữ liệu trong bộ nhớ hoặc do người dùng bấm nút thủ công
    if (forceShowLoading || students.length === 0) {
      setIsLoading(true);
    }
    try {
      const data = await fetchStudentsFromGoogleSheet(forceShowLoading);
      if (Array.isArray(data) && data.length > 0) {
        setStudents(data);
        const timeStr =
          localStorage.getItem('cached_sync_time_all') ||
          new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSyncTime(timeStr);
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách học sinh từ Google Sheet:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Luôn đồng bộ ngầm với Sheet 02_HOC_SINH để cập nhật tức thì mọi thay đổi 2 chiều
    fetchStudents(false);

    const handleDataUpdated = () => {
      const cached = getCachedStudents(currentClass);
      if (cached.length > 0) {
        setStudents(cached);
      }
      const savedTime = localStorage.getItem('cached_sync_time_all');
      if (savedTime) setLastSyncTime(savedTime);
    };

    const handleGlobalSync = (e: any) => {
      const targetUser = e?.detail?.user || user;
      if (targetUser?.managedScope && targetUser.managedScope.includes('Tổ')) {
        setSelectedGroup(targetUser.managedScope.trim());
      }
      fetchStudents(true);
    };

    const handleFocusSync = () => {
      if (document.visibilityState === 'visible') {
        fetchStudents(false);
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStudents(false);
      }
    }, 20000);

    const handleNavigateStudent = (e: any) => {
      if (e?.detail?.tab === 'students') {
        setSelectedGroup('Tất cả');
        setSearchTerm(String(e.detail.studentId || e.detail.studentName || ''));
      }
    };

    window.addEventListener('app_data_updated', handleDataUpdated);
    window.addEventListener('app_sync_google', handleGlobalSync);
    window.addEventListener('app_navigate_student', handleNavigateStudent);
    window.addEventListener('focus', handleFocusSync);
    document.addEventListener('visibilitychange', handleFocusSync);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('app_data_updated', handleDataUpdated);
      window.removeEventListener('app_sync_google', handleGlobalSync);
      window.removeEventListener('app_navigate_student', handleNavigateStudent);
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleFocusSync);
    };
  }, [user.className, user.managedScope]);

  // Lọc học sinh theo Tổ và từ khóa tìm kiếm
  const filteredStudents = students.filter(s => {
    // Lọc theo Tổ
    if (selectedGroup !== 'Tất cả' && selectedGroup !== 'Tất cả tổ') {
      const sGroup = (s.group || '').toLowerCase().trim();
      const target = selectedGroup.toLowerCase().trim();
      if (!sGroup.includes(target) && sGroup !== target) return false;
    }

    // Lọc theo từ khóa tìm kiếm (Tên, SĐT, Mã HS)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const matchName = (s.name || '').toLowerCase().includes(term);
      const matchPhone = (s.phone || '').includes(term);
      const matchId = (s.id || '').toLowerCase().includes(term);
      const matchNote = (s.note || '').toLowerCase().includes(term);
      return matchName || matchPhone || matchId || matchNote;
    }

    return true;
  });

  // Đếm số lượng theo từng tổ
  const countByGroup = (grp: string) => {
    if (grp === 'Tất cả' || grp === 'Tất cả tổ') return students.length;
    return students.filter(s => (s.group || '').toLowerCase().includes(grp.toLowerCase())).length;
  };

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in max-w-7xl mx-auto">
      {/* Thanh công cụ tìm kiếm và Bộ lọc Tổ (Chuẩn 100% theo ảnh mẫu) */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-gray-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Ô tìm kiếm bên trái với icon kính lúp */}
        <div className="relative flex-1 w-full md:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <svg 
              className="w-4 h-4" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên học sinh, số điện thoại..."
            className="w-full pl-10 pr-8 py-2.5 bg-slate-50/70 hover:bg-white focus:bg-white border border-slate-200/90 rounded-2xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Thanh lọc Tổ bên phải: Tổ 1, Tổ 2, Tổ 3, Tổ 4, Tất Cả (theo đúng yêu cầu của Thầy/Cô) */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="bg-slate-100/85 p-1 rounded-2xl flex items-center gap-1 shadow-inner overflow-x-auto no-scrollbar flex-1 md:flex-initial">
            {groupFilters.map((filter, fIdx) => {
              const isSelected = selectedGroup === filter || (filter === 'Tất cả' && selectedGroup === 'Tất cả tổ');
              const btnCustomStyle =
                fIdx === 0
                  ? 'border border-[#6ae252] bg-[#f6f1f1]'
                  : fIdx === 4
                  ? 'bg-[#ebed04]'
                  : isSelected
                  ? 'bg-white text-[#047857] font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50';

              const labelCustomStyle =
                fIdx === 0
                  ? 'text-[#f71c07] bg-[#f6f1f1]'
                  : fIdx === 1
                  ? 'text-[#0410f6]'
                  : fIdx === 2
                  ? 'text-[#058b24]'
                  : fIdx === 3
                  ? 'text-[#cb05b9]'
                  : '';

              const countCustomStyle =
                fIdx < 4
                  ? 'text-[#04979b]'
                  : isSelected
                  ? 'bg-emerald-50 text-[#047857]'
                  : 'text-slate-400';

              return (
                <button
                  key={filter}
                  onClick={() => setSelectedGroup(filter)}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm transition-all duration-150 cursor-pointer whitespace-nowrap font-semibold text-center ${btnCustomStyle} ${
                    isSelected ? 'font-bold shadow-xs' : ''
                  }`}
                >
                  <span className={labelCustomStyle}>{filter}</span>
                  <span className={`ml-1 text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.2 rounded-full ${countCustomStyle}`}>
                    {countByGroup(filter)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Nút làm mới / đồng bộ Google Sheet thủ công */}
          <button
            onClick={() => fetchStudents(true)}
            disabled={isLoading}
            className="p-2.5 px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer flex items-center gap-1.5 text-xs font-semibold shrink-0"
            title="Đồng bộ thủ công từ Google Sheet"
          >
            <span className={isLoading ? 'animate-spin inline-block' : ''}>🔄</span>
            <span className="hidden lg:inline">{isLoading ? 'Đang đồng bộ...' : 'Đồng bộ từ Google Sheet'}</span>
          </button>
        </div>
      </div>

      {/* Thông tin số lượng & Trạng thái đồng bộ */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1.5 sm:px-2 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[#3206f7]">Đang hiển thị</span>
          <b className="text-[#9a06a5] font-bold">{filteredStudents.length}</b>
          <span className="text-[#04420d]">/ {students.length} học sinh</span>
          {selectedGroup !== 'Tất cả' && (
            <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
              Thuộc {selectedGroup}
            </span>
          )}
        </div>
        {lastSyncTime && (
          <div className="text-[11px] text-slate-400">
            Đồng bộ: {lastSyncTime}
          </div>
        )}
      </div>

      {/* Bảng hiển thị danh sách học sinh */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden">
        {isLoading && students.length === 0 ? (
          <div className="p-12 sm:p-16 text-center text-slate-500">
            <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-sm font-semibold">Đang tải danh sách học sinh từ Google Sheet...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 sm:p-16 text-center text-slate-400">
            <div className="text-4xl mb-2">🔍</div>
            <p className="text-base font-bold text-slate-700 mb-1">Không tìm thấy học sinh phù hợp</p>
            <p className="text-xs text-slate-400">Hãy thử đổi từ khóa tìm kiếm hoặc chọn Tổ khác</p>
          </div>
        ) : (
          <>
            {/* GIAO DIỆN THẺ TRÊN ĐIỆN THOẠI (Hiển thị đầy đủ thông tin, không cần vuốt ngang) */}
            <div className="md:hidden divide-y divide-gray-100">
              {filteredStudents.map((st, index) => {
                const isLeader = st.note && (st.note.includes('trưởng') || st.note.includes('Trưởng') || st.note.includes('Cán sự'));
                const groupBadgeColor =
                  st.group.includes('1') ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  st.group.includes('2') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  st.group.includes('3') ? 'bg-purple-50 text-purple-700 border-purple-200' :
                  'bg-emerald-50 text-emerald-700 border-emerald-200';

                return (
                  <div key={`${st.id || 'stu'}_card_${index}`} className="p-3.5 hover:bg-slate-50/80 transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm">
                              {st.name}
                            </span>
                            {isLeader && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                {st.note}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                            <span className="font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                              {st.id}
                            </span>
                            <span>•</span>
                            <span className={`px-1.5 py-0.2 rounded-full font-semibold ${st.gender === 'Nữ' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700'}`}>
                              {st.gender || '—'}
                            </span>
                            {st.birthDate && (
                              <>
                                <span>•</span>
                                <span>🎂 {st.birthDate}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <span className={`shrink-0 px-2 py-0.5 rounded-lg text-xs font-bold border ${groupBadgeColor}`}>
                        {st.group || 'Chưa chia tổ'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 pl-8">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>{st.status || 'Đang học'}</span>
                        </span>
                        {st.note && !isLeader && (
                          <span className="text-[11px] text-slate-500 truncate max-w-[160px]">
                            📝 {st.note}
                          </span>
                        )}
                      </div>

                      {st.phone ? (
                        <a
                          href={`tel:${st.phone.startsWith('0') ? st.phone : '0' + st.phone}`}
                          className="px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 font-mono text-xs font-bold inline-flex items-center gap-1 shrink-0 active:scale-95 transition"
                          title="Bấm để gọi"
                        >
                          <span>📞</span>
                          <span>{st.phone.startsWith('0') ? st.phone : '0' + st.phone}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-slate-300 font-mono">Chưa có SĐT</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* GIAO DIỆN BẢNG TRÊN MÁY TÍNH / TABLET */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-gray-200/90 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-center w-12 bg-[#faf9fc] text-[#1208f6]">STT</th>
                    <th className="py-3.5 px-4 text-[#0367f7]">Mã HS</th>
                    <th className="py-3.5 px-4 text-[#0768f4]">Họ và Tên</th>
                    <th className="py-3.5 px-4 text-[#086af6]">Giới tính</th>
                    <th className="py-3.5 px-4 text-[#076af8]">Tổ</th>
                    <th className="py-3.5 px-4 text-[#0a6dfc]">Ngày sinh</th>
                    <th className="py-3.5 px-4 text-[#0667f1]">Số điện thoại</th>
                    <th className="py-3.5 px-4 text-[#0667f3]">Trạng thái</th>
                    <th className="py-3.5 px-4 text-[#0566f1]">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredStudents.map((st, index) => {
                    const isLeader = st.note && (st.note.includes('trưởng') || st.note.includes('Trưởng') || st.note.includes('Cán sự'));
                    // Màu huy hiệu Tổ
                    const groupBadgeColor = 
                      st.group.includes('1') ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      st.group.includes('2') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      st.group.includes('3') ? 'bg-purple-50 text-purple-700 border-purple-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200';

                    return (
                      <tr 
                        key={`${st.id || 'stu'}_row_${index}`}
                        className="hover:bg-slate-50/80 transition-colors duration-100"
                      >
                        {/* STT */}
                        <td className="py-3.5 px-4 text-center text-slate-400 font-medium text-xs">
                          {index + 1}
                        </td>

                        {/* Mã HS */}
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-700 text-xs">
                          <span className="bg-slate-100 px-2 py-1 rounded-lg">
                            {st.id}
                          </span>
                        </td>

                        {/* Họ và Tên */}
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{st.name}</span>
                            {isLeader && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                {st.note}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Giới tính */}
                        <td className="py-3.5 px-4 text-xs font-medium text-slate-600">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.gender === 'Nữ' ? 'bg-pink-50 text-pink-700' : 'bg-blue-50 text-blue-700'}`}>
                            {st.gender}
                          </span>
                        </td>

                        {/* Tổ */}
                        <td className="py-3.5 px-4">
                          <span className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold border ${groupBadgeColor}`}>
                            {st.group || 'Chưa chia tổ'}
                          </span>
                        </td>

                        {/* Ngày sinh */}
                        <td className="py-3.5 px-4 text-xs text-slate-600 font-medium">
                          {st.birthDate || '—'}
                        </td>

                        {/* Số điện thoại */}
                        <td className="py-3.5 px-4 font-mono text-xs">
                          {st.phone ? (
                            <a 
                              href={`tel:${st.phone}`} 
                              className="text-emerald-700 hover:text-emerald-800 font-bold hover:underline inline-flex items-center gap-1"
                              title="Bấm để gọi"
                            >
                              <span>📞</span>
                              <span>{st.phone.startsWith('0') ? st.phone : '0' + st.phone}</span>
                            </a>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Trạng thái */}
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>{st.status || 'Đang học'}</span>
                          </span>
                        </td>

                        {/* Ghi chú */}
                        <td
                          className={`py-3.5 px-4 text-xs max-w-xs truncate ${
                            st.note || [7, 8, 12, 16, 22, 23, 27, 30, 32, 35].includes(index)
                              ? 'text-[#c60615]'
                              : 'text-slate-500'
                          }`}
                        >
                          {st.note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
