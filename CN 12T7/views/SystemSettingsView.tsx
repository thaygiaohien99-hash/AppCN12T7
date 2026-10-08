import React, { useState, useEffect } from 'react';
import { User } from '../types';
import {
  GOOGLE_SCRIPT_URL,
  DEFAULT_GOOGLE_SHEET_URL,
  getGoogleScriptUrl,
  setGoogleScriptUrl,
  getGoogleSheetUrl,
  setGoogleSheetUrl,
  getSystemConfig,
  saveSystemConfig,
  DEFAULT_SYSTEM_CONFIG,
  fetchStudentsFromGoogleSheet,
  fetchCompetitionFromGoogleSheet,
  fetchBehaviorRulesFromGoogleSheet,
  fetchManagersFromGoogleSheet
} from '../services/dataService';
import appsScriptRawCode from '../google-apps-script/Code.gs?raw';

interface SystemSettingsViewProps {
  user: User;
  onSyncGoogle?: () => Promise<void> | void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  user,
  onSyncGoogle
}) => {
  const initialSysConfig = getSystemConfig();

  // State Thông tin Lớp, Năm học, Ký hiệu Khối, GVCN, Trường
  const [className, setClassName] = useState<string>(initialSysConfig.className);
  const [schoolYear, setSchoolYear] = useState<string>(initialSysConfig.schoolYear);
  const [gradeBadge, setGradeBadge] = useState<string>(initialSysConfig.gradeBadge);
  const [teacherName, setTeacherName] = useState<string>(initialSysConfig.teacherName);
  const [schoolName, setSchoolName] = useState<string>(initialSysConfig.schoolName);

  // State Địa chỉ URL Google Apps Script & Link Google Sheet
  const [scriptUrl, setScriptUrl] = useState<string>(() => getGoogleScriptUrl());
  const [sheetUrl, setSheetUrl] = useState<string>(() => getGoogleSheetUrl());

  // State trạng thái kiểm tra kết nối & thông báo
  const [isTestingSync, setIsTestingSync] = useState<boolean>(false);
  const [showCodeGuide, setShowCodeGuide] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState<{
    studentCount: number;
    ruleCount: number;
    lastSync: string;
    statusText: string;
    isSuccess: boolean;
  }>(() => {
    let stuCount = 0;
    let ruleCount = 20;
    try {
      const rawStu = localStorage.getItem('cached_students_all');
      if (rawStu) {
        const parsed = JSON.parse(rawStu);
        if (Array.isArray(parsed)) stuCount = parsed.length;
      }
      const rawRules = localStorage.getItem('cached_behavior_rules');
      if (rawRules) {
        const parsedR = JSON.parse(rawRules);
        if (Array.isArray(parsedR)) ruleCount = parsedR.length;
      }
    } catch {}
    return {
      studentCount: stuCount,
      ruleCount,
      lastSync: localStorage.getItem('cached_sync_time_all') || 'Chưa ghi nhận',
      statusText: 'Đã kết nối sẵn sàng',
      isSuccess: true
    };
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  useEffect(() => {
    const refreshStats = () => {
      try {
        const rawStu = localStorage.getItem('cached_students_all');
        const stuCount = rawStu ? JSON.parse(rawStu)?.length || 0 : 0;
        const rawRules = localStorage.getItem('cached_behavior_rules');
        const rCount = rawRules ? JSON.parse(rawRules)?.length || 20 : 20;
        const syncTime = localStorage.getItem('cached_sync_time_all') || 'Vừa đồng bộ';
        setSyncStats(prev => ({
          ...prev,
          studentCount: stuCount,
          ruleCount: rCount,
          lastSync: syncTime
        }));
      } catch {}
    };
    window.addEventListener('app_data_updated', refreshStats);
    return () => window.removeEventListener('app_data_updated', refreshStats);
  }, []);

  // Tự động gợi ý số Khối khi người dùng nhập tên Lớp (VD: 12T7 -> 12, 10T6 -> 10)
  const handleClassNameChange = (val: string) => {
    setClassName(val);
    const matchGrade = val.trim().match(/^\d+/);
    if (matchGrade && matchGrade[0]) {
      setGradeBadge(matchGrade[0]);
    }
  };

  // Lưu thông tin Lớp, Năm học, Ký hiệu Khối, GVCN, Trường
  const handleSaveClassAndYearInfo = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanClass = className.trim() || DEFAULT_SYSTEM_CONFIG.className;
    const cleanYear = schoolYear.trim() || DEFAULT_SYSTEM_CONFIG.schoolYear;
    const cleanBadge =
      gradeBadge.trim() || cleanClass.match(/^\d+/)?.[0] || DEFAULT_SYSTEM_CONFIG.gradeBadge;

    const updated = saveSystemConfig({
      className: cleanClass,
      schoolYear: cleanYear,
      gradeBadge: cleanBadge,
      teacherName: teacherName.trim(),
      schoolName: schoolName.trim()
    });

    setClassName(updated.className);
    setSchoolYear(updated.schoolYear);
    setGradeBadge(updated.gradeBadge);
    setTeacherName(updated.teacherName);
    setSchoolName(updated.schoolName);

    window.dispatchEvent(new CustomEvent('app_data_updated'));
    showToast(`✅ Đã cập nhật thông tin: Lớp ${updated.className} • Năm học: ${updated.schoolYear}`);
  };

  // Khôi phục thông tin Lớp & Năm học về mặc định (12T7 - 2026_2027)
  const handleResetClassInfo = () => {
    const resetCfg = saveSystemConfig(DEFAULT_SYSTEM_CONFIG);
    setClassName(resetCfg.className);
    setSchoolYear(resetCfg.schoolYear);
    setGradeBadge(resetCfg.gradeBadge);
    setTeacherName(resetCfg.teacherName);
    setSchoolName(resetCfg.schoolName);
    showToast('🔄 Đã khôi phục thông tin Lớp (12T7) và Năm học (2026_2027) mặc định.');
  };

  // Lưu địa chỉ URL Google Apps Script và đồng bộ dữ liệu ngay lập tức
  const handleSaveAndSyncScriptUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanScript = scriptUrl.trim();
    if (!cleanScript.startsWith('https://script.google.com/')) {
      showToast('⚠️ Địa chỉ URL Apps Script phải bắt đầu bằng https://script.google.com/macros/s/...');
      return;
    }

    setIsTestingSync(true);
    const savedScript = setGoogleScriptUrl(cleanScript);
    const savedSheet = setGoogleSheetUrl(sheetUrl.trim());
    setScriptUrl(savedScript);
    setSheetUrl(savedSheet);

    try {
      const [stuData, compData, rulesData] = await Promise.all([
        fetchStudentsFromGoogleSheet(true),
        fetchCompetitionFromGoogleSheet(true),
        fetchBehaviorRulesFromGoogleSheet(true),
        fetchManagersFromGoogleSheet(true)
      ]);

      if (onSyncGoogle) {
        await onSyncGoogle();
      } else {
        window.dispatchEvent(new CustomEvent('app_sync_google', { detail: { user } }));
      }
      window.dispatchEvent(new CustomEvent('app_data_updated'));

      const stuCount = Array.isArray(stuData) ? stuData.length : 0;
      const rCount = Array.isArray(rulesData) ? rulesData.length : 20;
      const nowStr = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      setSyncStats({
        studentCount: stuCount,
        ruleCount: rCount,
        lastSync: nowStr,
        statusText:
          compData !== null
            ? `Đồng bộ thành công (${stuCount} học sinh)`
            : 'Đã lưu URL và kết nối dữ liệu',
        isSuccess: true
      });

      showToast(`✅ Đã lưu địa chỉ Apps Script URL & đồng bộ thành công (${stuCount} học sinh)!`);
    } catch (err) {
      setSyncStats(prev => ({
        ...prev,
        statusText: 'Không thể kết nối tới URL Apps Script này. Vui lòng kiểm tra lại quyền truy cập.',
        isSuccess: false
      }));
      showToast('⚠️ Đã lưu URL nhưng kết nối bị gián đoạn. Vui lòng kiểm tra lại link Web App.');
    } finally {
      setIsTestingSync(false);
    }
  };

  // Khôi phục URL Google Apps Script gốc
  const handleRestoreDefaultScriptUrl = async () => {
    const defaultScript = setGoogleScriptUrl(GOOGLE_SCRIPT_URL);
    const defaultSheet = setGoogleSheetUrl(DEFAULT_GOOGLE_SHEET_URL);
    setScriptUrl(defaultScript);
    setSheetUrl(defaultSheet);
    showToast('🔄 Đã khôi phục địa chỉ URL Google Apps Script mặc định.');
    window.dispatchEvent(new CustomEvent('app_sync_google', { detail: { user } }));
  };

  // Làm sạch bộ nhớ đệm và tải lại mới hoàn toàn từ Google Sheet
  const handleClearCacheAndReloadSync = async () => {
    setIsTestingSync(true);
    try {
      localStorage.removeItem('cached_students_all');
      localStorage.removeItem('cached_competition_all');
      localStorage.removeItem('cached_raw_competition_sheet03');
      localStorage.removeItem('cached_weekly_details_map');
      localStorage.removeItem('cached_behavior_rules');
      localStorage.removeItem('cached_managers_all');

      const [stuData, , rulesData] = await Promise.all([
        fetchStudentsFromGoogleSheet(true),
        fetchCompetitionFromGoogleSheet(true),
        fetchBehaviorRulesFromGoogleSheet(true),
        fetchManagersFromGoogleSheet(true)
      ]);

      window.dispatchEvent(new CustomEvent('app_sync_google', { detail: { user } }));
      window.dispatchEvent(new CustomEvent('app_data_updated'));

      const nowStr = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      setSyncStats({
        studentCount: Array.isArray(stuData) ? stuData.length : 0,
        ruleCount: Array.isArray(rulesData) ? rulesData.length : 20,
        lastSync: nowStr,
        statusText: 'Đã làm mới bộ nhớ đệm & tải lại từ Google Sheet',
        isSuccess: true
      });

      showToast('✅ Đã làm sạch bộ nhớ đệm và đồng bộ mới 100% từ Google Sheet!');
    } catch {
      showToast('⚠️ Có lỗi khi tải lại dữ liệu từ Google Sheet.');
    } finally {
      setIsTestingSync(false);
    }
  };

  const handleCopyAppsScriptCode = async () => {
    try {
      await navigator.clipboard.writeText(appsScriptRawCode);
      showToast('📋 Đã sao chép toàn bộ mã Code.gs (Bản chuẩn v2.3) vào bộ nhớ tạm!');
    } catch {
      showToast('⚠️ Trình duyệt chặn copy tự động, vui lòng mở khung mã để sao chép.');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* Toast thông báo */}
      {toastMsg && (
        <div className="fixed bottom-20 left-3 right-3 sm:left-auto sm:bottom-6 sm:right-6 z-50 bg-[#14532d] text-white text-xs sm:text-sm font-bold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 border border-emerald-400">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* KHỐI 1: THÔNG TIN LỚP HỌC & NĂM HỌC (THAY ĐỔI TRỰC TIẾP TIÊU ĐỀ & HỆ THỐNG) */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-gray-200/90 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center text-2xl shrink-0">
              🏫
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                Thông tin Lớp học & Năm học
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Thay đổi Tên Lớp, Năm học, Ký hiệu Khối hiển thị trên thanh tiêu đề và trong các biểu mẫu báo cáo
              </p>
            </div>
          </div>

          {/* Xem trước trực tiếp (Live Preview) Khung Tiêu Đề */}
          <div className="flex items-center gap-3 bg-[#065f46] text-white px-4 py-2.5 rounded-2xl shadow-sm shrink-0 self-start md:self-auto">
            <div className="w-10 h-10 rounded-xl bg-white text-[#065f46] font-extrabold text-base flex items-center justify-center shadow-2xs shrink-0">
              {gradeBadge || '12'}
            </div>
            <div className="min-w-0 pr-1">
              <div className="text-base font-extrabold tracking-tight text-white leading-tight truncate">
                {className || '12T7'}
              </div>
              <div className="text-[11px] text-emerald-200 font-medium leading-tight mt-0.5 truncate">
                Năm học: {schoolYear || '2026_2027'}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveClassAndYearInfo} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* 1. Tên Lớp */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Tên Lớp <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={className}
                onChange={e => handleClassNameChange(e.target.value)}
                placeholder="VD: 12T7, 10T6..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200/90 text-sm font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <span className="block text-[11px] text-slate-400 mt-1">
                Hiển thị chính trên tiêu đề & báo cáo
              </span>
            </div>

            {/* 2. Năm Học */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Năm Học <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={schoolYear}
                onChange={e => setSchoolYear(e.target.value)}
                placeholder="VD: 2026_2027"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200/90 text-sm font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <span className="block text-[11px] text-slate-400 mt-1">
                Hiển thị dòng &ldquo;Năm học: ...&rdquo;
              </span>
            </div>

            {/* 3. Ký hiệu Khối (Biểu tượng góc trái) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Ký hiệu Khối (Ô vuông)
              </label>
              <input
                type="text"
                maxLength={4}
                value={gradeBadge}
                onChange={e => setGradeBadge(e.target.value)}
                placeholder="VD: 12, 10, 11"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200/90 text-sm font-extrabold text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <span className="block text-[11px] text-slate-400 mt-1">
                Biểu tượng ô trắng góc trái tiêu đề
              </span>
            </div>

            {/* 4. Giáo viên chủ nhiệm */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Giáo viên chủ nhiệm
              </label>
              <input
                type="text"
                value={teacherName}
                onChange={e => setTeacherName(e.target.value)}
                placeholder="Nhập tên GVCN..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200/90 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <span className="block text-[11px] text-slate-400 mt-1">
                Thông tin quản lý lớp chủ nhiệm
              </span>
            </div>

            {/* 5. Tên Trường */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Đơn vị / Trường học
              </label>
              <input
                type="text"
                value={schoolName}
                onChange={e => setSchoolName(e.target.value)}
                placeholder="Nhập tên trường..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200/90 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <span className="block text-[11px] text-slate-400 mt-1">
                Lưu trong hồ sơ hệ thống lớp
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
            <button
              type="button"
              onClick={handleResetClassInfo}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              Khôi phục mặc định (12T7 • 2026_2027)
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#047857] hover:bg-[#065f46] active:scale-95 text-white text-xs sm:text-sm font-extrabold shadow-sm transition cursor-pointer flex items-center gap-2"
            >
              <span>💾</span>
              <span>Lưu thông tin Lớp & Năm học</span>
            </button>
          </div>
        </form>
      </div>

      {/* KHỐI 2: CẤU HÌNH ĐỊA CHỈ URL GOOGLE APPS SCRIPT ĐỂ ĐỒNG BỘ 2 CHIỀU */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-gray-200/90 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-gray-100">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center text-2xl shrink-0">
              🔗
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                Kết nối & Đồng bộ Google Apps Script (Web App URL)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Địa chỉ URL kết nối 2 chiều giữa Ứng dụng và 4 Sheet: <code className="font-mono text-slate-700">01_QUAN_LI</code>, <code className="font-mono text-slate-700">02_HOC_SINH</code>, <code className="font-mono text-slate-700">03_THI_DUA_35_TUAN</code>, <code className="font-mono text-slate-700">04_THI_DUA</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${
                syncStats.isSuccess
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  syncStats.isSuccess ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span>{syncStats.statusText}</span>
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveAndSyncScriptUrl} className="space-y-4">
          {/* 1. Địa chỉ URL Google Apps Script */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs sm:text-sm font-extrabold text-slate-800">
                Địa chỉ URL Google Apps Script (Web App URL) <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] font-mono text-emerald-700">
                Định dạng: https://script.google.com/macros/s/.../exec
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                required
                value={scriptUrl}
                onChange={e => setScriptUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-300 text-xs sm:text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(scriptUrl);
                    showToast('📋 Đã sao chép địa chỉ URL Apps Script!');
                  } catch {}
                }}
                className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer shrink-0"
              >
                📋 Copy URL
              </button>
            </div>
          </div>

          {/* 2. Đường dẫn Google Sheet (Tùy chọn) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs sm:text-sm font-bold text-slate-700">
                Đường dẫn Bảng tính Google Sheet (Để tra cứu nhanh)
              </label>
              {sheetUrl && sheetUrl.startsWith('http') && (
                <a
                  href={sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-extrabold text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1"
                >
                  <span>↗ Mở bảng tính Google Sheet</span>
                </a>
              )}
            </div>
            <input
              type="url"
              value={sheetUrl}
              onChange={e => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 focus:bg-white border border-slate-200 text-xs sm:text-sm font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition"
            />
          </div>

          {/* Thông số đồng bộ hiện tại */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Học sinh đã đồng bộ</span>
              <span className="text-base font-black text-slate-900">{syncStats.studentCount} HS</span>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Danh mục hành vi (Sheet 04)</span>
              <span className="text-base font-black text-emerald-700">{syncStats.ruleCount} mục</span>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Đồng bộ gần nhất</span>
              <span className="text-xs font-mono font-bold text-slate-700">{syncStats.lastSync}</span>
            </div>
          </div>

          {/* Các nút thao tác lưu URL, kiểm tra đồng bộ & làm mới Cache */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRestoreDefaultScriptUrl}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Khôi phục URL mặc định
              </button>
              <button
                type="button"
                disabled={isTestingSync}
                onClick={handleClearCacheAndReloadSync}
                className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                🧹 Xóa bộ nhớ đệm & Tải lại từ Sheet
              </button>
            </div>

            <button
              type="submit"
              disabled={isTestingSync}
              className="px-5 py-2.5 rounded-xl bg-[#047857] hover:bg-[#065f46] active:scale-95 text-white text-xs sm:text-sm font-extrabold shadow-sm transition cursor-pointer disabled:opacity-60 flex items-center gap-2"
            >
              <span className={isTestingSync ? 'animate-spin inline-block' : ''}>🔄</span>
              <span>
                {isTestingSync
                  ? 'Đang kiểm tra & đồng bộ...'
                  : 'Lưu URL & Đồng bộ dữ liệu ngay'}
              </span>
            </button>
          </div>
        </form>

        {/* Mục mở rộng: Sao chép mã Google Apps Script (Code.gs v2.3) cho Sheet mới */}
        <div className="pt-3 border-t border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="text-xs text-slate-600">
              💡 <b>Mẹo khi đổi sang Google Sheet mới:</b> Sao chép mã <code className="font-mono font-bold">Code.gs (v2.3)</code> bên dưới dán vào mục <b>Tiện ích mở rộng &rarr; Apps Script</b> của file Sheet mới để tự động tạo đủ 4 Sheet chuẩn.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyAppsScriptCode}
                className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-extrabold transition cursor-pointer"
              >
                📋 Copy mã Code.gs (v2.3)
              </button>
              <button
                type="button"
                onClick={() => setShowCodeGuide(!showCodeGuide)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                {showCodeGuide ? 'Ẩn mã nguồn' : 'Xem mã Code.gs'}
              </button>
            </div>
          </div>

          {showCodeGuide && (
            <div className="mt-3 space-y-2">
              <div className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] max-h-64 overflow-y-auto whitespace-pre">
                {appsScriptRawCode}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
