import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../types';
import {
  BehaviorRuleItem,
  getCachedBehaviorRules,
  fetchBehaviorRulesFromGoogleSheet,
  fetchStudentsFromGoogleSheet,
  fetchCompetitionFromGoogleSheet,
  deduplicateStudentsById,
  deduplicateCompetitionRowsById
} from '../services/dataService';
import { StudentItem } from './StudentsView';
import {
  CompetitionStudentRow,
  DEFAULT_WEEK_BASE_SCORE,
  parseWeekCellDetail,
  ParsedWeekDetail
} from './CompetitionView';

interface HomeViewProps {
  user: User;
  selectedWeek?: number;
}

const getCachedStudentsList = (cls: string): StudentItem[] => {
  try {
    const raw =
      localStorage.getItem('cached_students_all') ||
      localStorage.getItem(`cached_students_${cls || '12T7'}`) ||
      localStorage.getItem('cached_students_10T6');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return deduplicateStudentsById(parsed);
    }
  } catch {}
  return [];
};

const getCachedCompetitionList = (cls: string): CompetitionStudentRow[] => {
  try {
    const raw =
      localStorage.getItem('cached_competition_all') ||
      localStorage.getItem(`cached_competition_${cls || '12T7'}`) ||
      localStorage.getItem('cached_competition_10T6');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return deduplicateCompetitionRowsById(parsed);
    }
  } catch {}
  return [];
};

const getCachedWeeklyDetailsMap = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem('cached_weekly_details_map');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
};

const formatAvgScore = (val: number): string => {
  if (isNaN(val)) return String(DEFAULT_WEEK_BASE_SCORE);
  const rounded = Math.round(val * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
};

export const HomeView: React.FC<HomeViewProps> = ({ user, selectedWeek }) => {
  const currentClass = user.className || '12T7';

  const [studentsList, setStudentsList] = useState<StudentItem[]>(() =>
    getCachedStudentsList(currentClass)
  );
  const [competitionRows, setCompetitionRows] = useState<CompetitionStudentRow[]>(() =>
    getCachedCompetitionList(currentClass)
  );
  const [weeklyDetailsMap, setWeeklyDetailsMap] = useState<Record<string, string>>(() =>
    getCachedWeeklyDetailsMap()
  );
  const [behaviorRules, setBehaviorRules] = useState<BehaviorRuleItem[]>(() =>
    getCachedBehaviorRules()
  );
  const [syncedWeek, setSyncedWeek] = useState<number | null>(null);
  const [isWarningModalOpen, setIsWarningModalOpen] = useState<boolean>(false);

  const refreshFromLocalStorage = () => {
    const cachedStu = getCachedStudentsList(currentClass);
    if (cachedStu.length > 0) setStudentsList(cachedStu);

    const cachedComp = getCachedCompetitionList(currentClass);
    if (cachedComp.length > 0) setCompetitionRows(cachedComp);

    setWeeklyDetailsMap(getCachedWeeklyDetailsMap());
    setBehaviorRules(getCachedBehaviorRules());
  };

  const fetchLatestHomeData = async () => {
    try {
      const [stuData, compData, rulesData] = await Promise.all([
        fetchStudentsFromGoogleSheet(false).catch(() => []),
        fetchCompetitionFromGoogleSheet(false).catch(() => null),
        fetchBehaviorRulesFromGoogleSheet(false).catch(() => getCachedBehaviorRules())
      ]);

      if (Array.isArray(rulesData) && rulesData.length > 0) {
        setBehaviorRules(rulesData);
      }

      if (Array.isArray(stuData) && stuData.length > 0) {
        setStudentsList(stuData);
      }

      if (Array.isArray(compData)) {
        refreshFromLocalStorage();
        if (getCachedCompetitionList(currentClass).length === 0) {
          setCompetitionRows(compData);
        }
      }
    } catch {
      // Giữ nguyên dữ liệu từ bộ nhớ đệm nếu ngoại tuyến
    }
  };

  useEffect(() => {
    refreshFromLocalStorage();
    fetchLatestHomeData();

    const handleDataUpdated = (e: any) => {
      if (e?.detail?.selectedWeek) {
        setSyncedWeek(Number(e.detail.selectedWeek));
      }
      refreshFromLocalStorage();
    };

    const handleGlobalSync = () => {
      refreshFromLocalStorage();
      fetchLatestHomeData();
    };

    const handleWindowFocus = () => {
      if (document.visibilityState === 'visible') {
        refreshFromLocalStorage();
      }
    };

    window.addEventListener('app_data_updated', handleDataUpdated);
    window.addEventListener('app_sync_google', handleGlobalSync);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      window.removeEventListener('app_data_updated', handleDataUpdated);
      window.removeEventListener('app_sync_google', handleGlobalSync);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [currentClass]);

  // Kiểm tra và trích xuất chi tiết lỗi bị "Cảnh Báo" của học sinh theo quy định trong Sheet 04_THI_DUA
  const getStudentWarningDetails = (
    parsedWk: ParsedWeekDetail,
    rules: BehaviorRuleItem[]
  ): { isWarning: boolean; warningErrors: string[]; allBehaviors: string[] } => {
    if (!parsedWk.hasRecord) {
      return { isWarning: false, warningErrors: [], allBehaviors: [] };
    }

    const warningRules = rules.filter(
      r =>
        r.isWarning ||
        (r.note &&
          (r.note.toLowerCase().includes('cảnh báo') ||
            r.note.toLowerCase().includes('canh bao'))) ||
        Number(r.points) <= -50
    );

    const warningErrors: string[] = [];
    const allBehaviors: string[] = parsedWk.behaviorItems.map(c => c.label);

    parsedWk.behaviorItems.forEach(chip => {
      const cleanChipName = chip.label
        .replace(/\(\s*(?:x\d+\s*:\s*)?[+-]?\d+(?:[.,]\d+)?\s*đ?\s*\)/gi, '')
        .replace(/\[cảnh báo\]/gi, '')
        .trim()
        .toLowerCase();

      const matchedRule = warningRules.find(r => {
        const ruleName = (r.behavior || '').trim().toLowerCase();
        return (
          ruleName &&
          (cleanChipName === ruleName ||
            cleanChipName.includes(ruleName) ||
            ruleName.includes(cleanChipName))
        );
      });

      if (chip.isWarning || chip.points <= -50 || matchedRule) {
        warningErrors.push(chip.label);
      }
    });

    const rawTextLower = (parsedWk.rawText || '').toLowerCase();
    warningRules.forEach(r => {
      const ruleName = (r.behavior || '').trim().toLowerCase();
      if (ruleName && rawTextLower.includes(ruleName)) {
        const alreadyIncluded = warningErrors.some(err =>
          err.toLowerCase().includes(ruleName)
        );
        if (!alreadyIncluded) {
          warningErrors.push(`${r.behavior} (${r.points}đ)`);
        }
      }
    });

    const isWarning =
      warningErrors.length > 0 ||
      rawTextLower.includes('cảnh báo') ||
      rawTextLower.includes('canh bao') ||
      parsedWk.minusPoints <= -50 ||
      (parsedWk.totalPoints !== null &&
        Number(parsedWk.totalPoints) <= DEFAULT_WEEK_BASE_SCORE - 50);

    if (isWarning && warningErrors.length === 0) {
      const minusItems = parsedWk.behaviorItems
        .filter(c => c.points < 0)
        .map(c => c.label);
      if (minusItems.length > 0) {
        warningErrors.push(...minusItems);
      } else if (parsedWk.behaviorsText) {
        warningErrors.push(parsedWk.behaviorsText);
      } else {
        warningErrors.push(`Điểm trừ nặng trong tuần (${parsedWk.minusPoints}đ)`);
      }
    }

    return {
      isWarning,
      warningErrors,
      allBehaviors
    };
  };

  // Kiểm tra học sinh có hành vi vi phạm nặng cần "Cảnh Báo" theo quy định trong Sheet 04_THI_DUA
  const isStudentWeekWarning = (parsedWk: ParsedWeekDetail, rules: BehaviorRuleItem[]): boolean => {
    return getStudentWarningDetails(parsedWk, rules).isWarning;
  };

  // Hợp nhất danh sách học sinh và dữ liệu thi đua thực tế
  const mergedRows = useMemo(() => {
    const compMap = new Map<string, CompetitionStudentRow>();
    competitionRows.forEach(r => {
      if (r && r.id) compMap.set(String(r.id).trim(), r);
    });

    const stuMap = new Map<string, StudentItem>();
    studentsList.forEach(s => {
      if (s && s.id) stuMap.set(String(s.id).trim(), s);
    });

    const buildRow = (
      id: string,
      name: string,
      clsName: string,
      grp: string,
      gender: string,
      stu?: StudentItem,
      comp?: CompetitionStudentRow
    ) => {
      const weeklyParsed: Record<string, ParsedWeekDetail> = {};
      for (let w = 1; w <= 35; w++) {
        const key = `Tuan_${w}`;
        const rawScoreVal = comp?.weeklyScores ? comp.weeklyScores[key] : null;
        const hasWeeklyDetailsObj = Boolean(
          comp && comp.weeklyDetails && typeof comp.weeklyDetails === 'object'
        );
        const rawDetailFromComp = hasWeeklyDetailsObj
          ? String(comp?.weeklyDetails?.[key] ?? '').trim()
          : '';

        const isScoreEmpty =
          rawScoreVal === null ||
          rawScoreVal === undefined ||
          String(rawScoreVal).trim() === '' ||
          isNaN(Number(rawScoreVal));

        let effectiveDetail = '';
        if (hasWeeklyDetailsObj) {
          if (rawDetailFromComp && rawDetailFromComp !== '#NUM!' && rawDetailFromComp !== 'NaN') {
            effectiveDetail = rawDetailFromComp;
          } else if (!isScoreEmpty) {
            effectiveDetail = String(rawScoreVal);
          }
        } else if (comp && !isScoreEmpty) {
          const numVal = Number(rawScoreVal);
          const expectedTotal = numVal < 45 ? DEFAULT_WEEK_BASE_SCORE + numVal : numVal;
          const cached = weeklyDetailsMap[`${id}_${key}`] || '';
          const parsedCached = cached ? parseWeekCellDetail(cached, null) : null;
          effectiveDetail =
            parsedCached && parsedCached.hasRecord && parsedCached.totalPoints === expectedTotal
              ? cached
              : String(rawScoreVal);
        }

        weeklyParsed[key] = parseWeekCellDetail(
          effectiveDetail,
          isScoreEmpty ? null : Number(rawScoreVal)
        );
      }

      return {
        id,
        name,
        className: clsName,
        group: grp,
        gender,
        birthDate: stu?.birthDate || '',
        phone: stu?.phone || '',
        status: stu?.status || 'Đang học',
        note: stu?.note || comp?.note || '',
        weeklyParsed
      };
    };

    if (studentsList.length > 0) {
      const uniqueStu = deduplicateStudentsById(studentsList);
      return uniqueStu.map(stu => {
        const sId = String(stu.id).trim();
        const comp = compMap.get(sId);
        return buildRow(
          sId,
          stu.name || comp?.name || '',
          stu.className || comp?.className || currentClass,
          stu.group || comp?.group || 'Tổ 1',
          stu.gender || '',
          stu,
          comp
        );
      });
    }

    const uniqueComp = deduplicateCompetitionRowsById(competitionRows);
    return uniqueComp.map(comp => {
      const cId = String(comp.id).trim();
      const stu = stuMap.get(cId);
      return buildRow(
        cId,
        stu?.name || comp.name || '',
        stu?.className || comp.className || currentClass,
        stu?.group || comp.group || 'Tổ 1',
        stu?.gender || '',
        stu,
        comp
      );
    });
  }, [studentsList, competitionRows, weeklyDetailsMap, currentClass]);

  // Xác định tuần thi đua hiện tại (ưu tiên tuần đang chọn trên thanh ngang hoặc tuần mới nhất có dữ liệu trên Sheet 03)
  const activeWeek = useMemo(() => {
    if (selectedWeek && selectedWeek >= 1 && selectedWeek <= 35) return selectedWeek;
    if (syncedWeek && syncedWeek >= 1 && syncedWeek <= 35) return syncedWeek;
    for (let w = 35; w >= 1; w--) {
      const hasAny = mergedRows.some(r => r.weeklyParsed[`Tuan_${w}`]?.hasRecord);
      if (hasAny) return w;
    }
    return 1;
  }, [mergedRows, selectedWeek, syncedWeek]);

  // Tính toán 5 chỉ số thực tế cho 5 thẻ trên Trang Chủ
  const dashboardStats = useMemo(() => {
    const totalStudents = mergedRows.length;
    let maleCount = 0;
    let femaleCount = 0;

    mergedRows.forEach(r => {
      const g = (r.gender || '').trim().toLowerCase();
      if (g === 'nam' || g.includes('nam')) {
        maleCount++;
      } else if (g === 'nữ' || g === 'nu' || g.includes('nữ') || g.includes('nu')) {
        femaleCount++;
      }
    });

    // Thống kê theo 4 Tổ thi đua
    const groupNames = ['Tổ 1', 'Tổ 2', 'Tổ 3', 'Tổ 4'];
    const wkKey = `Tuan_${activeWeek}`;
    const prevWkKey = activeWeek > 1 ? `Tuan_${activeWeek - 1}` : null;

    let classWeekTotal = 0;
    let classPrevWeekTotal = 0;
    let totalWarnings = 0;

    const groupDetails = groupNames.map(grpName => {
      const members = mergedRows.filter(r =>
        (r.group || '').toLowerCase().includes(grpName.toLowerCase())
      );

      let grpWeekTotal = 0;
      let grpYearTotal = 0;
      let grpPlusTotal = 0;
      let grpMinusTotal = 0;
      let grpWarningCount = 0;

      members.forEach(m => {
        const parsedCurr = m.weeklyParsed[wkKey];
        const currScore =
          parsedCurr && parsedCurr.hasRecord && parsedCurr.totalPoints !== null
            ? Number(parsedCurr.totalPoints)
            : DEFAULT_WEEK_BASE_SCORE;

        grpWeekTotal += currScore;
        classWeekTotal += currScore;

        if (parsedCurr && parsedCurr.hasRecord) {
          grpPlusTotal += parsedCurr.plusPoints;
          grpMinusTotal += parsedCurr.minusPoints;
        }

        if (parsedCurr && isStudentWeekWarning(parsedCurr, behaviorRules)) {
          totalWarnings++;
          grpWarningCount++;
        }

        if (prevWkKey) {
          const parsedPrev = m.weeklyParsed[prevWkKey];
          const prevScore =
            parsedPrev && parsedPrev.hasRecord && parsedPrev.totalPoints !== null
              ? Number(parsedPrev.totalPoints)
              : DEFAULT_WEEK_BASE_SCORE;
          classPrevWeekTotal += prevScore;
        } else {
          classPrevWeekTotal += DEFAULT_WEEK_BASE_SCORE;
        }

        for (let w = 1; w <= activeWeek; w++) {
          const pw = m.weeklyParsed[`Tuan_${w}`];
          grpYearTotal +=
            pw && pw.hasRecord && pw.totalPoints !== null
              ? Number(pw.totalPoints)
              : DEFAULT_WEEK_BASE_SCORE;
        }
      });

      const weekAvg =
        members.length > 0 ? grpWeekTotal / members.length : DEFAULT_WEEK_BASE_SCORE;
      const yearAvg =
        members.length > 0 ? grpYearTotal / members.length : DEFAULT_WEEK_BASE_SCORE;
      const weekDelta = grpWeekTotal - members.length * DEFAULT_WEEK_BASE_SCORE;

      return {
        groupName: grpName,
        memberCount: members.length,
        weekTotal: grpWeekTotal,
        weekAvg,
        yearAvg,
        weekPlus: grpPlusTotal,
        weekMinus: grpMinusTotal,
        weekDelta,
        warningCount: grpWarningCount
      };
    });

    const nonEmptyGroupSizes = groupDetails
      .map(g => g.memberCount)
      .filter(count => count > 0);
    const minGroupSize =
      nonEmptyGroupSizes.length > 0 ? Math.min(...nonEmptyGroupSizes) : 0;
    const maxGroupSize =
      nonEmptyGroupSizes.length > 0 ? Math.max(...nonEmptyGroupSizes) : 0;

    const groupRangeText =
      minGroupSize === maxGroupSize
        ? `${minGroupSize} học sinh / tổ`
        : `${minGroupSize} - ${maxGroupSize} học sinh / tổ`;

    const classAvg =
      totalStudents > 0 ? classWeekTotal / totalStudents : DEFAULT_WEEK_BASE_SCORE;
    const prevClassAvg =
      totalStudents > 0 ? classPrevWeekTotal / totalStudents : DEFAULT_WEEK_BASE_SCORE;
    const avgDiff = Math.round((classAvg - prevClassAvg) * 100) / 100;

    const sortedGroups = [...groupDetails]
      .sort((a, b) => {
        if (b.weekAvg !== a.weekAvg) return b.weekAvg - a.weekAvg;
        if (b.weekDelta !== a.weekDelta) return b.weekDelta - a.weekDelta;
        return b.yearAvg - a.yearAvg;
      })
      .map((g, idx) => ({
        ...g,
        rank: idx + 1
      }));

    const leadingGroup = sortedGroups[0] || {
      groupName: 'Tổ 1',
      weekAvg: DEFAULT_WEEK_BASE_SCORE,
      rank: 1
    };

    // Tính Top 5 học sinh có điểm thi đua cao nhất tuần
    const studentRankList = mergedRows.map(m => {
      const parsedCurr = m.weeklyParsed[wkKey];
      const weekScore =
        parsedCurr && parsedCurr.hasRecord && parsedCurr.totalPoints !== null
          ? Number(parsedCurr.totalPoints)
          : DEFAULT_WEEK_BASE_SCORE;
      const plusPoints = parsedCurr && parsedCurr.hasRecord ? parsedCurr.plusPoints : 0;
      const minusPoints = parsedCurr && parsedCurr.hasRecord ? parsedCurr.minusPoints : 0;
      const behaviorsText =
        parsedCurr && parsedCurr.hasRecord && parsedCurr.behaviorsText
          ? parsedCurr.behaviorsText.replace(/\s*\[cảnh báo\]/gi, '').trim()
          : '';

      let yearTotal = 0;
      for (let w = 1; w <= activeWeek; w++) {
        const pw = m.weeklyParsed[`Tuan_${w}`];
        yearTotal +=
          pw && pw.hasRecord && pw.totalPoints !== null
            ? Number(pw.totalPoints)
            : DEFAULT_WEEK_BASE_SCORE;
      }

      return {
        id: m.id,
        name: m.name,
        group: m.group,
        weekScore,
        plusPoints,
        minusPoints,
        behaviorsText,
        yearTotal
      };
    });

    studentRankList.sort((a, b) => {
      if (b.weekScore !== a.weekScore) return b.weekScore - a.weekScore;
      if (b.plusPoints !== a.plusPoints) return b.plusPoints - a.plusPoints;
      if (b.minusPoints !== a.minusPoints) return b.minusPoints - a.minusPoints;
      if (b.yearTotal !== a.yearTotal) return b.yearTotal - a.yearTotal;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });

    const top5Students = studentRankList.slice(0, 5).map((stu, idx) => ({
      ...stu,
      rank: idx + 1
    }));

    // Danh sách chi tiết các học sinh đang bị cảnh báo trong tuần hiện tại kèm thông tin HS và lỗi bị cảnh báo
    const warningStudents = mergedRows
      .map(m => {
        const parsedCurr = m.weeklyParsed[wkKey];
        if (!parsedCurr) return null;
        const warnInfo = getStudentWarningDetails(parsedCurr, behaviorRules);
        if (!warnInfo.isWarning) return null;
        const weekScore =
          parsedCurr.hasRecord && parsedCurr.totalPoints !== null
            ? Number(parsedCurr.totalPoints)
            : DEFAULT_WEEK_BASE_SCORE;
        return {
          id: m.id,
          name: m.name,
          className: m.className,
          group: m.group,
          gender: m.gender,
          birthDate: m.birthDate,
          phone: m.phone,
          status: m.status,
          note: m.note,
          weekScore,
          plusPoints: parsedCurr.plusPoints,
          minusPoints: parsedCurr.minusPoints,
          warningErrors: warnInfo.warningErrors,
          allBehaviors: warnInfo.allBehaviors
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      totalStudents,
      maleCount,
      femaleCount,
      groupCount: groupNames.length,
      groupRangeText,
      classAvg,
      avgDiff,
      totalWarnings,
      warningStudents,
      leadingGroup,
      sortedGroups,
      top5Students
    };
  }, [mergedRows, activeWeek, behaviorRules]);

  const compareLabel =
    activeWeek > 1 ? `so với Tuần ${activeWeek - 1}` : 'so với mốc 100đ';

  return (
    <div className="animate-fade-in max-w-7xl mx-auto space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-4">
        {/* 1. TỔNG SỐ HỌC SINH */}
        <div className="bg-[#eded9d] rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-gray-200/90 shadow-xs flex flex-col justify-between min-h-[116px] sm:min-h-[146px]">
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-600 leading-tight">
              Tổng số học sinh
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>

          <div className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight my-1 sm:my-1.5">
            {dashboardStats.totalStudents}
          </div>

          <div className="text-[11px] sm:text-xs font-bold text-emerald-600 truncate">
            {dashboardStats.maleCount} Nam • {dashboardStats.femaleCount} Nữ
          </div>
        </div>

        {/* 2. SỐ TỔ THI ĐUA */}
        <div className="bg-[#93bce8] rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-gray-200/90 shadow-xs flex flex-col justify-between min-h-[116px] sm:min-h-[146px]">
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-600 leading-tight">
              Số tổ thi đua
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
          </div>

          <div className="flex items-baseline gap-1 sm:gap-1.5 my-1 sm:my-1.5">
            <span className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              {dashboardStats.groupCount}
            </span>
            <span className="text-sm sm:text-base font-medium text-slate-500">tổ</span>
          </div>

          <div className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            {dashboardStats.groupRangeText}
          </div>
        </div>

        {/* 3. ĐIỂM TB LỚP */}
        <div className="bg-[#fab9fa] rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-gray-200/90 shadow-xs flex flex-col justify-between min-h-[116px] sm:min-h-[146px]">
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-600 leading-tight">
              Điểm TB lớp
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
          </div>

          <div className="text-2xl sm:text-4xl font-extrabold text-emerald-600 tracking-tight my-1 sm:my-1.5">
            {formatAvgScore(dashboardStats.classAvg)}
          </div>

          <div
            className={`text-[11px] sm:text-xs font-bold flex items-center gap-1 truncate ${
              dashboardStats.avgDiff >= 0 ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            <span>{dashboardStats.avgDiff >= 0 ? '↗' : '↘'}</span>
            <span className="truncate">
              {dashboardStats.avgDiff >= 0
                ? `+${formatAvgScore(dashboardStats.avgDiff)}`
                : formatAvgScore(dashboardStats.avgDiff)}{' '}
              {compareLabel}
            </span>
          </div>
        </div>

        {/* 4. ĐANG CẢNH BÁO */}
        <div
          onClick={() => setIsWarningModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') setIsWarningModalOpen(true);
          }}
          title="Bấm để xem thông tin học sinh và lỗi bị cảnh báo"
          className="bg-[#b6eeea] rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-gray-200/90 shadow-xs flex flex-col justify-between min-h-[116px] sm:min-h-[146px] cursor-pointer hover:ring-2 hover:ring-rose-400/60 active:scale-[0.99] transition-all"
        >
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-600 leading-tight">
              Đang cảnh báo
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
          </div>

          <div className="text-2xl sm:text-4xl font-extrabold text-rose-600 tracking-tight my-1 sm:my-1.5">
            {dashboardStats.totalWarnings}
          </div>

          <div className="text-[11px] sm:text-xs font-bold text-rose-600 truncate">
            {dashboardStats.totalWarnings > 0
              ? 'Xem thông tin HS & lỗi cảnh báo →'
              : 'Cần theo dõi & nhắc nhở'}
          </div>
        </div>

        {/* 5. TỔ DẪN ĐẦU TUẦN */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-1 bg-[#fffbeb] rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-[#fde68a] shadow-xs flex flex-col justify-between min-h-[104px] sm:min-h-[146px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-extrabold text-amber-900">
              Tổ dẫn đầu Tuần {activeWeek}
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-[#f59e0b] text-white flex items-center justify-center shrink-0 shadow-2xs">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
          </div>

          <div className="flex items-baseline justify-between lg:block my-1 sm:my-1.5">
            <div className="text-xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {dashboardStats.leadingGroup.groupName}
            </div>
            <div className="text-xs font-extrabold text-amber-800 lg:mt-1.5">
              {formatAvgScore(dashboardStats.leadingGroup.weekAvg)} đ • Xếp hạng 1
            </div>
          </div>
        </div>
      </div>

      {/* HAI CHỨC NĂNG BỔ SUNG: 1. XẾP HẠNG THI ĐUA TUẦN Ở CÁC TỔ & 2. TOP 5 HỌC SINH ĐIỂM CAO NHẤT TUẦN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* CHỨC NĂNG 1: XẾP HẠNG THI ĐUA TUẦN Ở CÁC TỔ */}
        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-gray-200/90 shadow-xs flex flex-col">
          <div className="flex items-start sm:items-center justify-between gap-2.5 sm:gap-3 mb-4 sm:mb-5">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-base sm:text-lg shrink-0 border border-amber-200/70">
                🏆
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-lg font-extrabold text-[#09a542] leading-snug">
                  Xếp hạng thi đua tuần ở các tổ
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 font-medium">
                  Điểm trung bình của 4 tổ trong Tuần {activeWeek}
                </p>
              </div>
            </div>
            <span className="px-2.5 sm:px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px] sm:text-xs shrink-0">
              Tuần {activeWeek}
            </span>
          </div>

          <div className="space-y-3 sm:space-y-3.5 flex-1">
            {dashboardStats.sortedGroups.map(grp => {
              const isTop1 = grp.rank === 1;
              const isTop2 = grp.rank === 2;
              const isTop3 = grp.rank === 3;
              const barPercent = Math.min(100, Math.max(25, (grp.weekAvg / 115) * 100));

              return (
                <div
                  key={grp.groupName}
                  className={`p-3 sm:p-4 rounded-2xl border transition-all ${
                    isTop1
                      ? 'bg-amber-50/60 border-amber-200 shadow-2xs'
                      : 'bg-slate-50/70 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <span
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center font-extrabold text-xs shrink-0 ${
                          isTop1
                            ? 'bg-amber-500 text-white shadow-2xs'
                            : isTop2
                            ? 'bg-slate-300 text-slate-800'
                            : isTop3
                            ? 'bg-amber-700/80 text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {isTop1 ? '🥇' : isTop2 ? '🥈' : isTop3 ? '🥉' : `#${grp.rank}`}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-900 text-sm sm:text-base">
                            {grp.groupName}
                          </span>
                          <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200">
                            Hạng {grp.rank}
                          </span>
                          {grp.warningCount > 0 && (
                            <span
                              onClick={() => setIsWarningModalOpen(true)}
                              className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 cursor-pointer transition"
                              title="Bấm để xem học sinh và lỗi bị cảnh báo"
                            >
                              ⚠️ {grp.warningCount} cảnh báo
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span>{grp.memberCount} HS</span>
                          <span>•</span>
                          <span>Tổng: {grp.weekTotal}đ</span>
                          <span>•</span>
                          <span className="text-emerald-600 font-semibold">+{grp.weekPlus}đ</span>
                          <span>/</span>
                          <span className="text-rose-600 font-semibold">{grp.weekMinus}đ</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-base sm:text-xl font-black whitespace-nowrap ${
                          grp.weekAvg > DEFAULT_WEEK_BASE_SCORE
                            ? 'text-emerald-600'
                            : grp.weekAvg < DEFAULT_WEEK_BASE_SCORE
                            ? 'text-rose-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {formatAvgScore(grp.weekAvg)} đ
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-semibold text-slate-400">
                        Điểm TB tổ
                      </div>
                    </div>
                  </div>

                  {/* Thanh tiến độ trực quan */}
                  <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isTop1
                          ? 'bg-amber-500'
                          : grp.weekAvg >= DEFAULT_WEEK_BASE_SCORE
                          ? 'bg-emerald-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CHỨC NĂNG 2: TOP 5 HỌC SINH CÓ ĐIỂM THI ĐUA CAO NHẤT TUẦN */}
        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-gray-200/90 shadow-xs flex flex-col">
          <div className="flex items-start sm:items-center justify-between gap-2.5 sm:gap-3 mb-4 sm:mb-5">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-base sm:text-lg shrink-0 border border-emerald-200/70">
                🌟
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] leading-[30px] font-extrabold text-[#034af2]">
                  Top 5 học sinh có điểm thi đua cao nhất tuần
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 font-medium">
                  Vinh danh các cá nhân tiêu biểu trong Tuần {activeWeek}
                </p>
              </div>
            </div>
            <span className="px-2.5 sm:px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold text-[11px] sm:text-xs shrink-0">
              Top 5 • Tuần {activeWeek}
            </span>
          </div>

          <div className="space-y-2.5 sm:space-y-3 flex-1">
            {dashboardStats.top5Students.map((stu, sIdx) => {
              const isRank1 = stu.rank === 1;
              const isRank2 = stu.rank === 2;
              const isRank3 = stu.rank === 3;

              return (
                <div
                  key={`${stu.id}_${sIdx}`}
                  className={`p-3 sm:p-3.5 rounded-2xl border flex items-center justify-between gap-2.5 sm:gap-3 transition-all ${
                    isRank1
                      ? 'bg-emerald-50/50 border-emerald-200 shadow-2xs'
                      : 'bg-slate-50/70 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <span
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center font-extrabold text-xs shrink-0 ${
                        isRank1
                          ? 'bg-amber-500 text-white shadow-2xs'
                          : isRank2
                          ? 'bg-slate-300 text-slate-800'
                          : isRank3
                          ? 'bg-amber-700/80 text-white'
                          : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      {isRank1 ? '🥇' : isRank2 ? '🥈' : isRank3 ? '🥉' : stu.rank}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span
                          className={`font-extrabold text-xs sm:text-base truncate ${
                            sIdx === 0
                              ? 'text-[#e73313]'
                              : sIdx === 1
                              ? 'text-[#044af1]'
                              : 'text-[#0a51f8]'
                          }`}
                        >
                          {stu.name}
                        </span>
                        <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/70 shrink-0">
                          {stu.group}
                        </span>
                      </div>
                      <div className="text-[11px] sm:text-xs text-slate-500 font-medium line-clamp-2 sm:truncate mt-0.5">
                        {stu.behaviorsText
                          ? stu.behaviorsText
                          : 'Chấp hành tốt nội quy (Mặc định 100đ)'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm sm:text-lg font-black whitespace-nowrap ${
                        stu.weekScore > DEFAULT_WEEK_BASE_SCORE
                          ? 'text-emerald-600'
                          : stu.weekScore < DEFAULT_WEEK_BASE_SCORE
                          ? 'text-rose-600'
                          : 'text-slate-900'
                      }`}
                    >
                      {stu.weekScore} đ
                    </div>
                    <div className="text-[10px] sm:text-[11px] font-bold flex items-center justify-end gap-1 whitespace-nowrap">
                      <span className="text-emerald-600">+{stu.plusPoints}đ</span>
                      <span className="text-slate-300">/</span>
                      <span className="text-rose-600">{stu.minusPoints}đ</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CỬA SỔ CHI TIẾT HỌC SINH ĐANG CẢNH BÁO & LỖI BỊ CẢNH BÁO */}
      {isWarningModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
          onClick={() => setIsWarningModalOpen(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl max-w-3xl w-full max-h-[92dvh] sm:max-h-[88vh] flex flex-col shadow-2xl border border-gray-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="px-4 py-3.5 sm:px-6 sm:py-4 bg-rose-600 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center text-lg shrink-0">
                  ⚠️
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm sm:text-lg font-extrabold truncate">
                      Danh sách Học sinh Đang Cảnh Báo
                    </h3>
                    <span className="bg-white text-rose-700 text-[11px] sm:text-xs font-extrabold px-2.5 py-0.5 rounded-full shrink-0">
                      Tuần {activeWeek} ({dashboardStats.warningStudents.length} HS)
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-rose-100 mt-0.5 truncate">
                    Thông tin chi tiết học sinh và các lỗi vi phạm bị cảnh báo trong Tuần {activeWeek}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWarningModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white font-bold cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            {/* Body danh sách học sinh & lỗi cảnh báo */}
            <div className="p-3.5 sm:p-5 overflow-y-auto flex-1 space-y-3 bg-slate-50/70">
              {dashboardStats.warningStudents.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 sm:p-10 text-center border border-gray-200/80 space-y-2">
                  <div className="text-4xl">✅</div>
                  <div className="text-sm sm:text-base font-extrabold text-slate-800">
                    Không có học sinh nào bị cảnh báo trong Tuần {activeWeek}
                  </div>
                  <p className="text-xs text-slate-500">
                    Tất cả học sinh trong lớp đều chấp hành tốt nội quy thi đua của tuần này.
                  </p>
                </div>
              ) : (
                dashboardStats.warningStudents.map((stu, idx) => (
                  <div
                    key={`${stu.id}_warn_${idx}`}
                    className="bg-white rounded-2xl p-3.5 sm:p-4 border-2 border-rose-200 shadow-xs space-y-3"
                  >
                    {/* Hàng 1: Thông tin học sinh */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="w-7 h-7 rounded-xl bg-rose-100 text-rose-700 font-extrabold text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 text-sm sm:text-base">
                              {stu.name}
                            </span>
                            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700">
                              Mã HS: {stu.id}
                            </span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {stu.group}
                            </span>
                            {stu.note && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                                {stu.note}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 flex-wrap">
                            {stu.gender && <span>Giới tính: <b>{stu.gender}</b></span>}
                            {stu.birthDate && (
                              <>
                                <span>•</span>
                                <span>Ngày sinh: <b>{stu.birthDate}</b></span>
                              </>
                            )}
                            {stu.phone && (
                              <>
                                <span>•</span>
                                <a
                                  href={`tel:${stu.phone.startsWith('0') ? stu.phone : '0' + stu.phone}`}
                                  className="text-emerald-700 hover:underline font-mono font-bold inline-flex items-center gap-1"
                                >
                                  📞 {stu.phone.startsWith('0') ? stu.phone : '0' + stu.phone}
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-block font-mono font-black text-xs sm:text-sm px-2.5 py-1 rounded-xl bg-rose-100 text-rose-700 border border-rose-300">
                          {stu.weekScore} đ
                        </span>
                        <div className="text-[10px] font-bold text-rose-600 mt-0.5">
                          Trừ: {stu.minusPoints}đ
                        </div>
                      </div>
                    </div>

                    {/* Hàng 2: Chi tiết Lỗi bị cảnh báo */}
                    <div className="p-2.5 sm:p-3 rounded-xl bg-rose-50/90 border border-rose-200 space-y-1.5">
                      <div className="text-[11px] sm:text-xs font-extrabold text-rose-800 flex items-center gap-1.5">
                        <span>🚨</span>
                        <span>Lỗi bị cảnh báo trong Tuần {activeWeek}:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {stu.warningErrors.map((errText, eIdx) => (
                          <span
                            key={eIdx}
                            className="inline-flex items-center px-2.5 py-1 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-2xs"
                          >
                            ⚠️ {errText}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Hàng 3: Nút liên kết nhanh tới Thẻ Thi Đua & Thẻ Học Sinh */}
                    <div className="flex items-center justify-end gap-2 pt-0.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setIsWarningModalOpen(false);
                          window.dispatchEvent(
                            new CustomEvent('app_navigate_student', {
                              detail: {
                                tab: 'students',
                                studentId: stu.id,
                                studentName: stu.name,
                                group: stu.group
                              }
                            })
                          );
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer flex items-center gap-1"
                      >
                        <span>👤</span>
                        <span>Xem thông tin Học sinh</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsWarningModalOpen(false);
                          window.dispatchEvent(
                            new CustomEvent('app_navigate_student', {
                              detail: {
                                tab: 'competition',
                                studentId: stu.id,
                                studentName: stu.name,
                                group: stu.group,
                                week: activeWeek
                              }
                            })
                          );
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition cursor-pointer flex items-center gap-1 shadow-2xs"
                      >
                        <span>🏆</span>
                        <span>Xem chi tiết lỗi trong Thi Đua →</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Modal */}
            <div className="px-4 py-3 sm:px-6 bg-white border-t border-gray-200 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsWarningModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
