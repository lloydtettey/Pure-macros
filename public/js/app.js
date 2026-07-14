// Cache-first PWA service worker — registered after the page load event so it
// never competes with the initial render for network/CPU time.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Non-critical — the app still works fully online without it.
    });
  });
}

const API = '/api';
const CUSTOM_FOOD_ID = '__custom__';
// Foods surfaced by the live universal search (/api/foods/search) aren't part
// of the local FOOD_DB reference list, so they're cached here by id — lets
// resolveSelectedFood() and the quick-add flow treat them like any other
// selectable food while still logging them server-side as a custom food.
const externalFoodCache = new Map();
let globalFoodSearchTimer = null;
const AUTH_TOKEN_KEY = 'macrogram_token';
// Caches { username } (never the token or anything server-authoritative)
// purely so the profile header/name can paint instantly on a returning
// session instead of showing a "—" placeholder while /auth/me is in flight.
// It is NOT a substitute for the token — bootstrapAuth() below still
// re-validates every session against the server before any real data loads.
const CURRENT_USER_KEY = 'pure_macros_current_user';
const THEME_KEY = 'pure_macros_theme';
const WEIGHT_UNIT_KEY = 'pure_macros_weight_unit';
const HEIGHT_UNIT_KEY = 'pure_macros_height_unit';
const UNIT_SYSTEM_KEY = 'pure_macros_unit_system';

// Global Dynamic Multi-Unit System Toggle preference ('metric' | 'imperial'),
// read once at load and mutated in place by setUnitSystemPreference() below —
// recipe modals and the workout weight ledger both key off this same value.
let userUnitPreference = localStorage.getItem(UNIT_SYSTEM_KEY) === 'imperial' ? 'imperial' : 'metric';

const RING_CIRCUMFERENCE = 2 * Math.PI * 70;

const TAB_LABELS = { today: 'Today', plan: 'Plan', progress: 'Progress', more: 'More' };

const state = {
  date: todayStr(),
  settings: null,
  entries: [],
  foods: [],
  water: 0,
  waterOz: 0,
  streak: 0,
  weights: [],
  exercise: [],
  steps: [],
  sleep: [],
  history: null,
  user: null,
  mealPlan: null,
  routines: [],
  fasting: null,
  reminders: [],
  devices: null,
  savedMeals: [],
  savedRecipes: [],
  savedFoods: [],
  customExercises: []
};

function todayStr() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
}

// ---------- DOM refs ----------
const toastEl = document.getElementById('toast');

const appRoot = document.getElementById('appRoot');
const authOverlay = document.getElementById('authOverlay');
const loginForm = document.getElementById('loginForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const registerForm = document.getElementById('registerForm');
const registerUsername = document.getElementById('registerUsername');
const registerPassword = document.getElementById('registerPassword');
const registerError = document.getElementById('registerError');

const tabTitleEl = document.getElementById('tabTitle');
const tabViews = document.querySelectorAll('.tab-view');
const bottomNavBtns = document.querySelectorAll('.bottom-nav-btn');
let currentTab = 'today';
let currentProgressSubtab = 'overview';
let calNutMacMode = 'calories';
let stepsLoaded = false;
let sleepLoaded = false;
let cnmRangeInitialized = false;
let macroCardMode = 'percent'; // toggled by the Macros card swap icon; 'percent' | 'grams'

const dateStripEl = document.getElementById('dateStrip');
const todayHeaderBtn = document.getElementById('todayHeaderBtn');
const todayHeaderLabelEl = document.getElementById('todayHeaderLabel');
const calendarDropdownEl = document.getElementById('calendarDropdown');
const calMonthYearLabelEl = document.getElementById('calMonthYearLabel');
const calPrevMonthBtn = document.getElementById('calPrevMonthBtn');
const calNextMonthBtn = document.getElementById('calNextMonthBtn');
const calendarGridEl = document.getElementById('calendarGrid');
const calendarWeekdaysEl = document.getElementById('calendarWeekdays');
const calendarMonthYearBtn = document.getElementById('calendar-month-year-btn');
const monthYearPickerViewEl = document.getElementById('month-year-picker-view');
const pickerMonthColEl = document.getElementById('pickerMonthCol');
const pickerYearColEl = document.getElementById('pickerYearCol');
const headerStreakChipEl = document.getElementById('headerStreakChip');
const headerStreakValueEl = document.getElementById('headerStreakValue');
const streakPopoverEl = document.getElementById('streakPopover');
const streakPopoverCloseBtn = document.getElementById('streakPopoverClose');
const streakPopoverLogBtn = document.getElementById('streakPopoverLogBtn');
const macrosSwapBtn = document.getElementById('macrosSwapBtn');
const dayTypeSelectorEl = document.getElementById('dayTypeSelector');

const onboardingOverlay = document.getElementById('onboardingOverlay');
const onboardingPanel = document.querySelector('.onboarding-panel');
const onboardingCloseBtn = document.getElementById('onboardingCloseBtn');
const onboardingDots = document.querySelectorAll('.onboarding-dot');
const onboardingSteps = document.querySelectorAll('.onboarding-step');
const onboardingStep1Title = document.getElementById('onboardingStep1Title');
const onboardingHeightUnitHint = document.getElementById('onboardingHeightUnitHint');
const onboardingWeightUnitHint = document.getElementById('onboardingWeightUnitHint');
const onboardingHeightInput = document.getElementById('onboardingHeightInput');
const onboardingWeightInput = document.getElementById('onboardingWeightInput');
const onboardingAgeInput = document.getElementById('onboardingAgeInput');
const onboardingStep1Error = document.getElementById('onboardingStep1Error');
const onboardingStep1Next = document.getElementById('onboardingStep1Next');
const onboardingActivityLevel = document.getElementById('onboardingActivityLevel');
const onboardingFitnessGoal = document.getElementById('onboardingFitnessGoal');
const onboardingStep2Error = document.getElementById('onboardingStep2Error');
const onboardingStep2Back = document.getElementById('onboardingStep2Back');
const onboardingGenerateBtn = document.getElementById('onboardingGenerateBtn');
const onboardingStep3Title = document.getElementById('onboardingStep3Title');
const onboardingStep3Tagline = document.getElementById('onboardingStep3Tagline');
const onboardingFinishBtn = document.getElementById('onboardingFinishBtn');

// ---------- Plan tab (hub) + Meal Planner 9-step wizard refs ----------
const planEmptyStateEl = document.getElementById('planEmptyState');
const planHubEl = document.getElementById('planHub');
const planHubSubtitleEl = document.getElementById('planHubSubtitle');
const planRecipeGridEl = document.getElementById('planRecipeGrid');
const planStartQuizBtn = document.getElementById('planStartQuizBtn');
const planRetakeQuizBtn = document.getElementById('planRetakeQuizBtn');

const planWizardOverlay = document.getElementById('planWizardOverlay');
const pwProgressFillEl = document.getElementById('pwProgressFill');
const pwStepNumberEl = document.getElementById('pwStepNumber');
const pwSkipBtn = document.getElementById('pwSkipBtn');
const pwBodyEl = document.getElementById('pwBody');
const pwBackBtn = document.getElementById('pwBackBtn');
const pwNextBtn = document.getElementById('pwNextBtn');
const pwErrorEl = document.getElementById('pwError');

const pwNameInput = document.getElementById('pwNameInput');
const pwWeightInput = document.getElementById('pwWeightInput');
const pwGoalWeightInput = document.getElementById('pwGoalWeightInput');
const pwMealVolumeSelect = document.getElementById('pwMealVolumeSelect');
const pwPreferredMacroSelect = document.getElementById('pwPreferredMacroSelect');
const pwGroceryFreqSelect = document.getElementById('pwGroceryFreqSelect');

const pwAllergyGrid = document.getElementById('pwAllergyGrid');
const pwExclusionInput = document.getElementById('pwExclusionInput');
const pwExclusionAddBtn = document.getElementById('pwExclusionAddBtn');
const pwExclusionChipsEl = document.getElementById('pwExclusionChips');
const pwCuisineList = document.getElementById('pwCuisineList');

const pwSwipeDeck = document.getElementById('pwSwipeDeck');
const pwSwipeEmptyEl = document.getElementById('pwSwipeEmpty');
const pwSwipeLikeBtn = document.getElementById('pwSwipeLikeBtn');
const pwSwipeDislikeBtn = document.getElementById('pwSwipeDislikeBtn');
const pwServingsMinus = document.getElementById('pwServingsMinus');
const pwServingsPlus = document.getElementById('pwServingsPlus');
const pwServingsValueEl = document.getElementById('pwServingsValue');

const profileForm = document.getElementById('profileForm');
const profileError = document.getElementById('profileError');
const profileUsernameEl = document.getElementById('profileUsername');
const moreMenuListEl = document.getElementById('moreMenuList');
const moreProfileHeaderCard = document.getElementById('moreProfileHeaderCard');
const mfpLastSyncEl = document.getElementById('mfpLastSync');
const mfpMetricCurrentEl = document.getElementById('mfpMetricCurrent');
const mfpMetricStartEl = document.getElementById('mfpMetricStart');
const mfpMetricLostEl = document.getElementById('mfpMetricLost');

const profileDetailsView = document.getElementById('profileDetailsView');
const profileDetailsBackBtn = document.getElementById('profileDetailsBackBtn');
const profileDetailsListEl = document.getElementById('profileDetailsList');

const profileFieldSheet = document.getElementById('profileFieldSheet');
const profileFieldSheetBackdrop = document.getElementById('profileFieldSheetBackdrop');
const profileFieldCloseBtn = document.getElementById('profileFieldCloseBtn');
const profileFieldSaveBtn = document.getElementById('profileFieldSaveBtn');
const profileFieldTitleEl = document.getElementById('profileFieldTitle');
const profileFieldTextInput = document.getElementById('profileFieldTextInput');
const profileFieldSelectInput = document.getElementById('profileFieldSelectInput');
const settingsView = document.getElementById('settingsView');
const settingsBackBtn = document.getElementById('settingsBackBtn');
const settingsMenuListEl = document.getElementById('settingsMenuList');

const appAppearanceView = document.getElementById('appAppearanceView');
const appAppearanceBackBtn = document.getElementById('appAppearanceBackBtn');
const appearanceCardGridEl = document.getElementById('appearanceCardGrid');

const diarySettingsView = document.getElementById('diarySettingsView');
const diarySettingsBackBtn = document.getElementById('diarySettingsBackBtn');
const diarySettingsListEl = document.getElementById('diarySettingsList');
const defaultSearchTabValueLabelEl = document.getElementById('defaultSearchTabValueLabel');

const defaultSearchTabView = document.getElementById('defaultSearchTabView');
const defaultSearchTabBackBtn = document.getElementById('defaultSearchTabBackBtn');
const defaultSearchTabRadioListEl = document.getElementById('defaultSearchTabRadioList');

const customizeMealNamesView = document.getElementById('customizeMealNamesView');
const customizeMealNamesBackBtn = document.getElementById('customizeMealNamesBackBtn');
const customizeMealNamesListEl = document.getElementById('customizeMealNamesList');

const startOfWeekView = document.getElementById('startOfWeekView');
const startOfWeekBackBtn = document.getElementById('startOfWeekBackBtn');
const startOfWeekSelect = document.getElementById('startOfWeekSelect');

const sharingPrivacyView = document.getElementById('sharingPrivacyView');
const sharingPrivacyBackBtn = document.getElementById('sharingPrivacyBackBtn');
const sharingPrivacyMenuListEl = document.getElementById('sharingPrivacyMenuList');
const sharingProfileSearchableSwitch = document.getElementById('sharingProfileSearchableSwitch');

const diarySharingView = document.getElementById('diarySharingView');
const diarySharingBackBtn = document.getElementById('diarySharingBackBtn');
const diarySharingRadioListEl = document.getElementById('diarySharingRadioList');

const emailSettingsView = document.getElementById('emailSettingsView');
const emailSettingsBackBtn = document.getElementById('emailSettingsBackBtn');
const emailTokenValueEl = document.getElementById('emailTokenValue');
const resendConfirmationBtn = document.getElementById('resendConfirmationBtn');
const emailAnnouncementsSwitch = document.getElementById('emailAnnouncementsSwitch');
const emailHealthTipsSwitch = document.getElementById('emailHealthTipsSwitch');
const emailWeeklyDigestSwitch = document.getElementById('emailWeeklyDigestSwitch');
const findMeByEmailSwitch = document.getElementById('findMeByEmailSwitch');

const healthKitSharingView = document.getElementById('healthKitSharingView');
const healthKitBackBtn = document.getElementById('healthKitBackBtn');
const healthKitSyncSwitch = document.getElementById('healthKitSyncSwitch');
const healthKitSubListEl = document.getElementById('healthKitSubList');
const healthKitEnergyBurnSwitch = document.getElementById('healthKitEnergyBurnSwitch');
const healthKitMacrosSwitch = document.getElementById('healthKitMacrosSwitch');
const healthKitBodyWeightSwitch = document.getElementById('healthKitBodyWeightSwitch');

const socialConnectView = document.getElementById('socialConnectView');
const socialConnectBackBtn = document.getElementById('socialConnectBackBtn');
const connectFacebookBtn = document.getElementById('connectFacebookBtn');
const connectGoogleBtn = document.getElementById('connectGoogleBtn');

const changePasswordView = document.getElementById('changePasswordView');
const changePasswordBackBtn = document.getElementById('changePasswordBackBtn');
const currentPasswordInput = document.getElementById('currentPasswordInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const confirmNewPasswordInput = document.getElementById('confirmNewPasswordInput');
const changePasswordSubmitBtn = document.getElementById('changePasswordSubmitBtn');
const changePasswordError = document.getElementById('changePasswordError');

const myExercisesView = document.getElementById('myExercisesView');
const myExercisesBackBtn = document.getElementById('myExercisesBackBtn');
const myExercisesListEl = document.getElementById('myExercisesList');
const myExercisesEmptyEl = document.getElementById('myExercisesEmpty');
const addCustomExerciseBtn = document.getElementById('addCustomExerciseBtn');
const addCustomExerciseOverlay = document.getElementById('addCustomExerciseOverlay');
const closeAddCustomExerciseModal = document.getElementById('closeAddCustomExerciseModal');
const cancelAddCustomExercise = document.getElementById('cancelAddCustomExercise');
const addCustomExerciseForm = document.getElementById('addCustomExerciseForm');
const customExerciseNameInput = document.getElementById('customExerciseNameInput');
const customExerciseCaloriesInput = document.getElementById('customExerciseCaloriesInput');
const customExerciseError = document.getElementById('customExerciseError');

const pushNotificationsView = document.getElementById('pushNotificationsView');
const pushNotificationsBackBtn = document.getElementById('pushNotificationsBackBtn');
const notifDisabledBanner = document.getElementById('notifDisabledBanner');
const notifBannerSettingsLink = document.getElementById('notifBannerSettingsLink');
const pushNotifRowsList = document.getElementById('pushNotifRowsList');
const quietHoursTimeRow = document.getElementById('quietHoursTimeRow');
const quietHoursStartInput = document.getElementById('quietHoursStartInput');
const quietHoursEndInput = document.getElementById('quietHoursEndInput');

const mockDeviceSettingsOverlay = document.getElementById('mockDeviceSettingsOverlay');
const closeMockDeviceSettings = document.getElementById('closeMockDeviceSettings');
const mockAllowNotificationsSwitch = document.getElementById('mockAllowNotificationsSwitch');

const healthKitConnectingOverlay = document.getElementById('healthKitConnectingOverlay');

const iosTopToastEl = document.getElementById('iosTopToast');
const iosTopToastIconEl = document.getElementById('iosTopToastIcon');
const iosTopToastTextEl = document.getElementById('iosTopToastText');

const iosWheelPickerSheet = document.getElementById('iosWheelPickerSheet');
const iosWheelPickerBackdrop = document.getElementById('iosWheelPickerBackdrop');
const iosWheelPickerCloseBtn = document.getElementById('iosWheelPickerCloseBtn');
const iosWheelPickerSaveBtn = document.getElementById('iosWheelPickerSaveBtn');
const iosWheelPickerTitle = document.getElementById('iosWheelPickerTitle');
const iosWheelPickerTrack = document.getElementById('iosWheelPickerTrack');
const goalsWorkoutsPerWeekRow = document.getElementById('goalsWorkoutsPerWeekRow');
const goalsMinutesPerWorkoutRow = document.getElementById('goalsMinutesPerWorkoutRow');

const logoutConfirmOverlay = document.getElementById('logoutConfirmOverlay');
const closeLogoutConfirmModal = document.getElementById('closeLogoutConfirmModal');
const cancelLogoutConfirm = document.getElementById('cancelLogoutConfirm');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

const goalsView = document.getElementById('goalsView');
const goalsBackBtn = document.getElementById('goalsBackBtn');
const nutritionGoalsMenuListEl = document.getElementById('nutritionGoalsMenuList');
const goalsStartingWeightEl = document.getElementById('goalsStartingWeight');
const goalsCurrentWeightEl = document.getElementById('goalsCurrentWeight');
const goalsTargetWeightEl = document.getElementById('goalsTargetWeight');
const goalsWeeklyGoalEl = document.getElementById('goalsWeeklyGoal');
const goalsActivityLevelEl = document.getElementById('goalsActivityLevel');
const goalsWorkoutsPerWeekEl = document.getElementById('goalsWorkoutsPerWeek');
const goalsMinutesPerWorkoutEl = document.getElementById('goalsMinutesPerWorkout');

const nutrientGoalsView = document.getElementById('nutrientGoalsView');
const nutrientGoalsBackBtn = document.getElementById('nutrientGoalsBackBtn');
const nutrientGoalsListEl = document.getElementById('nutrientGoalsList');

const weightUnitToggle = document.getElementById('weightUnitToggle');
const heightUnitToggle = document.getElementById('heightUnitToggle');
const weightUnitHintEl = document.getElementById('weightUnitHint');
const weightLogLabelEl = document.getElementById('weightLogLabel');
const heightCmField = document.getElementById('heightCmField');
const heightFtInField = document.getElementById('heightFtInField');
const heightCmInput = document.getElementById('heightCmInput');
const heightFtInput = document.getElementById('heightFtInput');
const heightInInput = document.getElementById('heightInInput');
const targetWeightInput = document.getElementById('targetWeightInput');
const targetWeightUnitHintEl = document.getElementById('targetWeightUnitHint');

const mealCards = document.querySelectorAll('.meal-card');

const waterCupsEl = document.getElementById('waterCups');
const waterFilledEl = document.getElementById('waterFilled');

const weightForm = document.getElementById('weightForm');
const weightDateInput = document.getElementById('weightDateInput');
const weightInput = document.getElementById('weightInput');
const weightError = document.getElementById('weightError');
const weightTimelineEl = document.getElementById('weightTimeline');
const weightChartAxisEl = document.getElementById('weightChartAxis');
const weightChartSvgEl = document.getElementById('weightChartSvg');
const weightChartEmptyEl = document.getElementById('weightChartEmpty');

const progressSubnavBtns = document.querySelectorAll('.progress-subnav-btn');
const progressSubviews = document.querySelectorAll('.progress-subview');
const manageGoalsBtn = document.getElementById('manageGoalsBtn');
const overviewCalorieChartEl = document.getElementById('overviewCalorieChart');

const cnmToggle = document.getElementById('cnmToggle');
const cnmPanels = document.querySelectorAll('.cnm-panel');
const historyStartSelect = document.getElementById('historyStartSelect');
const historyEndSelect = document.getElementById('historyEndSelect');
const caloriesHistoryChartEl = document.getElementById('caloriesHistoryChart');
const nutrientListEl = document.getElementById('nutrientList');
const macroRingsEl = document.getElementById('macroRings');

const stepsForm = document.getElementById('stepsForm');
const stepsInput = document.getElementById('stepsInput');
const stepsError = document.getElementById('stepsError');
const stepsTimelineEl = document.getElementById('stepsTimeline');
const stepsChartAxisEl = document.getElementById('stepsChartAxis');
const stepsMonthlyChartEl = document.getElementById('stepsMonthlyChart');

const sleepForm = document.getElementById('sleepForm');
const sleepAwakeInput = document.getElementById('sleepAwakeInput');
const sleepRemInput = document.getElementById('sleepRemInput');
const sleepCoreInput = document.getElementById('sleepCoreInput');
const sleepDeepInput = document.getElementById('sleepDeepInput');
const sleepBedTimeInput = document.getElementById('sleepBedTimeInput');
const sleepWakeTimeInput = document.getElementById('sleepWakeTimeInput');
const sleepQualityStarsEl = document.getElementById('sleepQualityStars');
const sleepError = document.getElementById('sleepError');
const sleepTimelineEl = document.getElementById('sleepTimeline');
let selectedSleepQuality = 0;

function renderSleepQualityStars() {
  sleepQualityStarsEl.querySelectorAll('.sleep-star-btn').forEach((btn) => {
    btn.classList.toggle('filled', Number(btn.dataset.star) <= selectedSleepQuality);
  });
}
sleepQualityStarsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.sleep-star-btn');
  if (!btn) return;
  const star = Number(btn.dataset.star);
  selectedSleepQuality = selectedSleepQuality === star ? 0 : star;
  renderSleepQualityStars();
});

const fabLogBtn = document.getElementById('fabLogBtn');
const logOverlay = document.getElementById('logOverlay');
const closeLogOverlayBtn = document.getElementById('closeLogOverlay');
const logMealSelect = document.getElementById('logMealSelect');
const logSearchInput = document.getElementById('logSearchInput');
const logSubtabsEl = document.getElementById('logSubtabs');
const logPanelHistory = document.getElementById('logPanelHistory');
const logPanelMeals = document.getElementById('logPanelMeals');
const logPanelRecipes = document.getElementById('logPanelRecipes');
const logPanelFoods = document.getElementById('logPanelFoods');
const logMealScanFileInput = document.getElementById('logMealScanFileInput');
const logQuickAddForm = document.getElementById('logQuickAddForm');
const logQuickAddFood = document.getElementById('logQuickAddFood');
const logQuickAddGrams = document.getElementById('logQuickAddGrams');
const logQuickAddError = document.getElementById('logQuickAddError');
const logRecentList = document.getElementById('logRecentList');
const logPopularList = document.getElementById('logPopularList');
let currentLogSubtab = 'history';

const weightMeasurementsOverlay = document.getElementById('weightMeasurementsOverlay');
const closeWeightMeasurementsBtn = document.getElementById('closeWeightMeasurementsModal');

const macroGoalsOverlay = document.getElementById('macroGoalsOverlay');
const closeMacroGoalsBtn = document.getElementById('closeMacroGoalsModal');
const macroGoalsError = document.getElementById('macroGoalsError');
const macroGoalCaloriesSlider = document.getElementById('macroGoalCaloriesSlider');
const macroGoalCarbsSlider = document.getElementById('macroGoalCarbsSlider');
const macroGoalProteinSlider = document.getElementById('macroGoalProteinSlider');
const macroGoalFatSlider = document.getElementById('macroGoalFatSlider');
const macroGoalCaloriesValueEl = document.getElementById('macroGoalCaloriesValue');
const macroGoalCarbsValueEl = document.getElementById('macroGoalCarbsValue');
const macroGoalProteinValueEl = document.getElementById('macroGoalProteinValue');
const macroGoalFatValueEl = document.getElementById('macroGoalFatValue');

const DAY_TYPE_DEFAULT_LABELS = { rest: 'Rest Day', work: 'Work Day', gym: 'Gym Training' };
const targetProfilesError = document.getElementById('targetProfilesError');
const saveTargetProfilesBtn = document.getElementById('saveTargetProfilesBtn');
const targetProfileInputs = {};
for (const dayType of ['rest', 'work', 'gym']) {
  targetProfileInputs[dayType] = {
    label: document.getElementById(`profileLabel_${dayType}`),
    calories: document.getElementById(`profileCalories_${dayType}`),
    protein: document.getElementById(`profileProtein_${dayType}`),
    carbs: document.getElementById(`profileCarbs_${dayType}`),
    fat: document.getElementById(`profileFat_${dayType}`)
  };
}

const scanOverlay = document.getElementById('scanOverlay');
const scanImagePreview = document.getElementById('scanImagePreview');
const scanDetectedName = document.getElementById('scanDetectedName');
const scanConfidence = document.getElementById('scanConfidence');
const scanGramsInput = document.getElementById('scanGramsInput');
const scanError = document.getElementById('scanError');
const closeScanBtn = document.getElementById('closeScan');
const cancelScanBtn = document.getElementById('cancelScan');
const confirmScanBtn = document.getElementById('confirmScan');
let scanContext = null; // { meal, foodId, name }

// ---------- Bottom utility dock DOM refs (Add Water / Add Weight / Add Exercise) ----------
const exerciseCaloriesBurnedEl = document.getElementById('exerciseCaloriesBurned');
const exerciseEntryListEl = document.getElementById('exerciseEntryList');

const addWaterScreen = document.getElementById('addWaterScreen');
const addWaterBackBtn = document.getElementById('addWaterBackBtn');
const addWaterSaveBtn = document.getElementById('addWaterSaveBtn');
const addWaterCupFill = document.getElementById('addWaterCupFill');
const addWaterAmountInput = document.getElementById('addWaterAmountInput');
const addWaterUnitLabel = document.getElementById('addWaterUnitLabel');
const addWaterChangeUnitBtn = document.getElementById('addWaterChangeUnitBtn');
const addWaterUnitValue = document.getElementById('addWaterUnitValue');
const addWaterQuickAddRowEl = document.getElementById('addWaterQuickAddRow');
const waterCardUnitSwitcher = document.getElementById('waterCardUnitSwitcher');
const waterCardQuickAdd = document.getElementById('waterCardQuickAdd');
const WATER_DISPLAY_UNIT_KEY = 'pure_macros_water_unit';
const OZ_TO_ML = 29.5735;
// Quick-add amounts are defined per-unit (not just relabeled conversions) so
// the numbers stay the "nice" values a person expects in that unit — 8/16/24
// oz cups, or 250/500/750 ml bottles. Whichever button is tapped, the amount
// is converted to ounces before it ever touches state/localStorage, since oz
// is the uniform base unit water totals are always stored in.
const WATER_QUICKADD_BY_UNIT = { oz: [8, 16, 24], ml: [250, 500, 750] };
let addWaterPendingOz = 0;

const addWeightScreen = document.getElementById('addWeightScreen');
const addWeightBackBtn = document.getElementById('addWeightBackBtn');
const addWeightSaveBtn = document.getElementById('addWeightSaveBtn');
const addWeightWeightRow = document.getElementById('addWeightWeightRow');
const addWeightValueDisplay = document.getElementById('addWeightValueDisplay');
const addWeightDateRow = document.getElementById('addWeightDateRow');
const addWeightDateDisplay = document.getElementById('addWeightDateDisplay');
const addWeightDateInput = document.getElementById('addWeightDateInput');
const addWeightPhotoRow = document.getElementById('addWeightPhotoRow');
const addWeightPhotoValue = document.getElementById('addWeightPhotoValue');
const addWeightPhotoInput = document.getElementById('addWeightPhotoInput');
const addWeightPhotoPreview = document.getElementById('addWeightPhotoPreview');
let addWeightPending = { weightKg: null, date: null, photo: null };

const weightWheelSheet = document.getElementById('weightWheelSheet');
const weightWheelBackdrop = document.getElementById('weightWheelBackdrop');
const weightWheelCloseBtn = document.getElementById('weightWheelCloseBtn');
const weightWheelSaveBtn = document.getElementById('weightWheelSaveBtn');
const wheelColStones = document.getElementById('wheelColStones');
const wheelColPounds = document.getElementById('wheelColPounds');
const wheelColFraction = document.getElementById('wheelColFraction');
const WHEEL_FRACTIONS = [0, 0.25, 0.5, 0.75];
const WHEEL_FRACTION_LABELS = { 0: '0', 0.25: '¼', 0.5: '½', 0.75: '¾' };

const addExerciseSheet = document.getElementById('addExerciseSheet');
const addExerciseSheetPanel = document.getElementById('addExerciseSheetPanel');
const addExerciseGrabber = document.getElementById('addExerciseGrabber');
const exerciseQuickForm = document.getElementById('exerciseQuickForm');
const exerciseNameSelect = document.getElementById('exerciseNameSelect');
const exerciseMinutesInput = document.getElementById('exerciseMinutesInput');
const exerciseCaloriesInput = document.getElementById('exerciseCaloriesInput');
const exerciseFormError = document.getElementById('exerciseFormError');
const EXERCISE_PRESETS = {
  cardio: ['Running', 'Cycling', 'Swimming', 'Walking', 'Other Cardio'],
  strength: ['Weightlifting', 'Bodyweight', 'CrossFit', 'Other Strength']
};
let activeExerciseType = null;

const quickAddScreen = document.getElementById('quickAddScreen');
const quickAddBackBtn = document.getElementById('quickAddBackBtn');
const quickAddSaveBtn = document.getElementById('quickAddSaveBtn');
const quickAddMealSelect = document.getElementById('quickAddMealSelect');
const quickAddCaloriesInput = document.getElementById('quickAddCaloriesInput');
const quickAddFatInput = document.getElementById('quickAddFatInput');
const quickAddCarbsInput = document.getElementById('quickAddCarbsInput');
const quickAddProteinInput = document.getElementById('quickAddProteinInput');
const quickAddTimeInput = document.getElementById('quickAddTimeInput');
const quickAddError = document.getElementById('quickAddError');

const barcodeScanOverlay = document.getElementById('barcodeScanOverlay');
const barcodeVideo = document.getElementById('barcodeVideo');
const closeBarcodeScanBtn = document.getElementById('closeBarcodeScan');
const barcodeHint = document.getElementById('barcodeHint');
const barcodeError = document.getElementById('barcodeError');
let barcodeMediaStream = null;

const voiceLogSheet = document.getElementById('voiceLogSheet');
const voiceLogSheetPanel = document.getElementById('voiceLogSheetPanel');
const voiceLogGrabber = document.getElementById('voiceLogGrabber');
const voiceLogPreviewText = document.getElementById('voiceLogPreviewText');
const voiceLogError = document.getElementById('voiceLogError');
const voiceLogMicBtn = document.getElementById('voiceLogMicBtn');
let voiceLogRecognition = null;
let voiceLogListening = false;
let voiceLogFinalTranscript = '';

// ---------- Auth ----------
function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
}

function cacheCurrentUser(username) {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ username }));
}

function getCachedCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

// Wraps fetch() with the session token and centralized 401 handling, for
// every endpoint that reads or writes a signed-in user's data.
async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handleSessionExpired();
  }
  return res;
}

// Inline #app-splash (index.html head) is still on screen at this point —
// it painted before style.css/app.js even started loading. Once we know
// whether a cached session is valid or the login form needs to show, fade
// it out and drop it from the DOM entirely so it can't intercept taps.
const appSplashEl = document.getElementById('app-splash');
function hideSplash() {
  if (!appSplashEl || !appSplashEl.isConnected) return;
  appSplashEl.classList.add('app-splash-hide');
  appSplashEl.addEventListener('transitionend', () => appSplashEl.remove(), { once: true });
}
// Safety net — if some unexpected error keeps both the auth-resolved and
// auth-failed paths below from ever running, don't leave the splash stuck
// on screen forever.
setTimeout(hideSplash, 4000);

function handleSessionExpired() {
  clearToken();
  showAuthOverlay();
  showToast('Session expired — please log in again', true);
}

function showAuthOverlay() {
  hideSplash();
  appRoot.classList.remove('app-visible');
  appRoot.classList.add('hidden');
  authOverlay.classList.remove('closing');
  // Undo the head script's pre-paint hide, e.g. mid-session 401 — otherwise
  // .has-session keeps display:none on the overlay and the login form this
  // function is trying to surface never actually appears.
  document.documentElement.classList.remove('has-session');
}

function revealApp() {
  hideSplash();
  authOverlay.classList.add('closing');
  appRoot.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      appRoot.classList.add('app-visible');
      // buildDateStrip()'s initial scrollIntoView ran while appRoot was
      // still display:none (app boots straight into the auth overlay), so
      // it had no real scrollable container to anchor to and could leave
      // the strip parked away from Today. Re-run it now that the strip has
      // genuine layout, so it reliably lands on today's exact date.
      refreshDateStripSelection(false);
    });
    syncFixedBarHeights();
  });
}

// The header and bottom nav are position:fixed so they can stretch fully
// edge-to-edge on real phones; .app reserves matching padding via these
// custom properties so page content never sits underneath them.
const appFixedTopEl = document.getElementById('appFixedTop');
const bottomNavEl = document.getElementById('bottomNav');
function syncFixedBarHeights() {
  document.documentElement.style.setProperty('--fixed-top-h', `${appFixedTopEl.offsetHeight}px`);
  document.documentElement.style.setProperty('--bottom-nav-h', `${bottomNavEl.offsetHeight}px`);
}
if (typeof ResizeObserver !== 'undefined') {
  const fixedBarObserver = new ResizeObserver(syncFixedBarHeights);
  fixedBarObserver.observe(appFixedTopEl);
  fixedBarObserver.observe(bottomNavEl);
}
window.addEventListener('resize', syncFixedBarHeights);

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t === tab));
  const isLogin = tab.dataset.tab === 'login';
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
}

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchAuthTab(tab));
});

// ---------- OAuth (Google / Apple) sign-in ----------
// Client IDs aren't secret (they're sent to Google/Apple on every request
// regardless), so they're fetched from the server rather than hardcoded here
// — that lets .env configuration turn each button on/off without touching
// this file.
let googleCodeClient = null;
let appleAuthReady = false;

async function initOAuthProviders() {
  try {
    const res = await fetch(`${API}/oauth/config`);
    const config = await res.json();

    if (config.googleClientId && window.google?.accounts?.oauth2) {
      googleCodeClient = google.accounts.oauth2.initCodeClient({
        client_id: config.googleClientId,
        scope: 'openid email profile',
        ux_mode: 'popup',
        callback: handleGoogleAuthResponse
      });
    }

    if (config.appleClientId && window.AppleID) {
      AppleID.auth.init({
        clientId: config.appleClientId,
        scope: 'name email',
        redirectURI: window.location.origin,
        usePopup: true
      });
      appleAuthReady = true;
    }
  } catch {
    // OAuth is optional — username/password sign-in still works if this fails.
  }
}
initOAuthProviders();

async function completeOAuthSignIn(endpoint, body) {
  const res = await fetch(`${API}/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Sign-in failed');
  setToken(data.token);
  cacheCurrentUser(data.username);
  revealApp();
  initApp();
  checkOnboarding();
}

async function handleGoogleAuthResponse(response) {
  if (response.error) return; // user closed the popup — no error to surface
  try {
    await completeOAuthSignIn('google', { code: response.code });
  } catch (err) {
    registerError.textContent = err.message;
  }
}

document.getElementById('oauthGoogleBtn')?.addEventListener('click', () => {
  if (!googleCodeClient) {
    showToast('Google sign-in is not configured', true);
    return;
  }
  googleCodeClient.requestCode();
});

document.getElementById('oauthAppleBtn')?.addEventListener('click', async () => {
  if (!appleAuthReady) {
    showToast('Apple sign-in is not configured', true);
    return;
  }
  try {
    const result = await AppleID.auth.signIn();
    await completeOAuthSignIn('apple', { identityToken: result.authorization.id_token, user: result.user });
  } catch (err) {
    if (err?.error === 'popup_closed_by_user') return;
    registerError.textContent = err.message || 'Apple sign-in failed';
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log in');
    setToken(data.token);
    cacheCurrentUser(data.username);
    revealApp();
    initApp();
    checkOnboarding();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.textContent = '';
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: registerUsername.value.trim(), password: registerPassword.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create account');
    setToken(data.token);
    cacheCurrentUser(data.username);
    revealApp();
    initApp();
    checkOnboarding();
  } catch (err) {
    registerError.textContent = err.message;
  }
});

async function handleLogout() {
  try {
    await authFetch(`${API}/auth/logout`, { method: 'POST' });
  } catch {
    // Logging out locally still succeeds even if the request itself failed.
  }
  clearToken();
  location.reload();
}

// ---------- Theme ----------
const systemDarkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeColorMetaEl = document.getElementById('themeColorMeta');
const THEME_COLOR_DARK = '#0a0a0c';
const THEME_COLOR_LIGHT = '#ffffff';

// Preference is what the user picked: 'light', 'dark', or 'system'.
function getStoredThemePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

// Resolved is the actual surface to render: 'light' or 'dark'. For 'system'
// this reads the live OS media query so it stays correct after e.g. sunset.
function resolveTheme(preference) {
  return preference === 'system' ? (systemDarkMediaQuery.matches ? 'dark' : 'light') : preference;
}

function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute('data-theme', resolved);
  document.body.classList.toggle('dark-theme', resolved === 'dark');
  if (themeColorMetaEl) themeColorMetaEl.setAttribute('content', resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  appearanceCardGridEl.querySelectorAll('.appearance-card').forEach((card) => {
    card.classList.toggle('appearance-card--active', card.dataset.themeChoice === preference);
  });
}

function setTheme(preference) {
  // Suspend transitions/animations for one tick so every themed element
  // swaps color instantly instead of animating in parallel — that parallel
  // recalculation is what was causing visible lag on phone GPUs.
  document.body.classList.add('no-transitions');
  localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
  setTimeout(() => document.body.classList.remove('no-transitions'), 50);
}

applyTheme(getStoredThemePreference());

appearanceCardGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.appearance-card');
  if (!card) return;
  setTheme(card.dataset.themeChoice);
});
appAppearanceBackBtn.addEventListener('click', () => closeSubView(appAppearanceView));

// Live-follows OS-level theme switches (e.g. iOS auto dark mode at sunset)
// whenever the user's saved preference is 'system'.
systemDarkMediaQuery.addEventListener('change', () => {
  if (getStoredThemePreference() === 'system') applyTheme('system');
});

// ---------- Unit conversion (Weight kg/lbs, Height cm/ft-in) ----------
function getWeightUnit() {
  return localStorage.getItem(WEIGHT_UNIT_KEY) === 'lbs' ? 'lbs' : 'kg';
}
function getHeightUnit() {
  return localStorage.getItem(HEIGHT_UNIT_KEY) === 'ftin' ? 'ftin' : 'cm';
}
function kgToLbs(kg) {
  return kg * 2.20462;
}
function lbsToKg(lbs) {
  return lbs / 2.20462;
}
function cmToFtIn(cm) {
  const totalInches = cm / 2.54;
  const ft = Math.floor(totalInches / 12);
  const inch = Math.round((totalInches - ft * 12) * 10) / 10;
  return { ft, inch };
}
function ftInToCm(ft, inch) {
  return ((ft || 0) * 12 + (inch || 0)) * 2.54;
}

function applyWeightUnitUI() {
  const unit = getWeightUnit();
  weightUnitToggle.querySelectorAll('.unit-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
  weightUnitHintEl.textContent = `(${unit})`;
  weightInput.placeholder = `Weight (${unit})`;
  weightLogLabelEl.textContent = state.date === todayStr() ? "Log today's weight" : `Log weight for ${formatDateLabel(state.date)}`;
  targetWeightUnitHintEl.textContent = `(${unit})`;
  targetWeightInput.placeholder = `e.g. ${unit === 'lbs' ? 165 : 75}`;
  renderWeights();
}

function readTargetWeightKgFromField() {
  const v = Number(targetWeightInput.value);
  if (!v || v <= 0) return null;
  return getWeightUnit() === 'lbs' ? Math.round(lbsToKg(v) * 10) / 10 : v;
}

function writeTargetWeightFieldFromKg(kg) {
  if (kg === null || kg === undefined || Number.isNaN(kg)) {
    targetWeightInput.value = '';
    return;
  }
  targetWeightInput.value = getWeightUnit() === 'lbs' ? Math.round(kgToLbs(kg) * 10) / 10 : kg;
}

function applyHeightUnitUI() {
  const unit = getHeightUnit();
  heightUnitToggle.querySelectorAll('.unit-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
  heightCmField.classList.toggle('hidden', unit !== 'cm');
  heightFtInField.classList.toggle('hidden', unit !== 'ftin');
}

function readHeightCmFromFields() {
  const unit = getHeightUnit();
  if (unit === 'cm') {
    const v = Number(heightCmInput.value);
    return v > 0 ? v : null;
  }
  const ft = Number(heightFtInput.value) || 0;
  const inch = Number(heightInInput.value) || 0;
  if (!ft && !inch) return null;
  return ftInToCm(ft, inch);
}

function writeHeightFieldsFromCm(cm) {
  if (cm === null || cm === undefined || Number.isNaN(cm)) {
    heightCmInput.value = '';
    heightFtInput.value = '';
    heightInInput.value = '';
    return;
  }
  if (getHeightUnit() === 'cm') {
    heightCmInput.value = Math.round(cm * 10) / 10;
  } else {
    const { ft, inch } = cmToFtIn(cm);
    heightFtInput.value = ft;
    heightInInput.value = inch;
  }
}

weightUnitToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.unit-toggle-btn');
  if (!btn) return;
  const currentTargetKg = readTargetWeightKgFromField();
  localStorage.setItem(WEIGHT_UNIT_KEY, btn.dataset.unit);
  applyWeightUnitUI();
  writeTargetWeightFieldFromKg(currentTargetKg);
});

heightUnitToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.unit-toggle-btn');
  if (!btn) return;
  const currentCm = readHeightCmFromFields();
  localStorage.setItem(HEIGHT_UNIT_KEY, btn.dataset.unit);
  applyHeightUnitUI();
  writeHeightFieldsFromCm(currentCm);
});

// ---------- Dynamic Multi-Unit System Toggle (Metric g/kg/°C <-> Imperial oz/lbs/°F) ----------
const unitSystemToggleEl = document.getElementById('unitSystemToggle');
const workoutWeightEls = document.querySelectorAll('.wr-log-weight');

function applyUnitSystemUI() {
  unitSystemToggleEl.dataset.active = userUnitPreference;
  unitSystemToggleEl.querySelectorAll('.unit-segmented-btn').forEach((btn) => {
    const active = btn.dataset.unitSystem === userUnitPreference;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

// Converts the logged exercise weight text on each Workout Routines card
// between its stored lbs/kg values for the active unit preference.
function applyWorkoutWeightUnits() {
  workoutWeightEls.forEach((el) => {
    el.textContent = userUnitPreference === 'metric'
      ? `${el.dataset.weightKg} kg`
      : `${el.dataset.weightLbs} lbs`;
  });
}

function setUnitSystemPreference(preference) {
  if (preference !== 'metric' && preference !== 'imperial') return;
  userUnitPreference = preference;
  localStorage.setItem(UNIT_SYSTEM_KEY, preference);
  applyUnitSystemUI();
  // Batches the recipe modal and workout ledger text updates into the next
  // paint so the sliding thumb and every dependent row flip in the same
  // frame instead of the ledger lagging a tick behind the toggle.
  requestAnimationFrame(() => {
    renderRecipeModalUnits();
    applyWorkoutWeightUnits();
    renderWorkoutModalUnits();
  });
}

applyUnitSystemUI();
applyWorkoutWeightUnits();

unitSystemToggleEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.unit-segmented-btn');
  if (!btn) return;
  setUnitSystemPreference(btn.dataset.unitSystem);
});

// ---------- Tabs (Today / Plan / Progress / More) ----------
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  tabViews.forEach((view) => view.classList.toggle('hidden', view.dataset.tabView !== tab));
  tabTitleEl.textContent = TAB_LABELS[tab] || '';

  if (tab === 'plan') openPlanTabView();
  if (tab === 'progress') openProgressTab();
  if (tab === 'more') openMoreTab();

  requestAnimationFrame(syncFixedBarHeights);
}

bottomNavBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.target;
    if (tab === currentTab) return;
    // Strip .active off the old node and paint it onto the new one right on
    // the click — this is cheap (class + style recalc only) and must commit
    // its own frame before the heavier view-toggle/data-fetch work in
    // switchTab gets a chance to block the main thread.
    bottomNavBtns.forEach((b) => b.classList.toggle('active', b === btn));
    requestAnimationFrame(() => switchTab(tab));
  });
});

// ---------- Progress sub-navigation ----------
// Calories/Nutrients/Macros all share one subview with an internal 3-way
// toggle; the other four sub-nav entries each map to their own subview.
const PROGRESS_SUBNAV_MAP = {
  overview: { subview: 'overview' },
  calories: { subview: 'calnutmac', mode: 'calories' },
  nutrients: { subview: 'calnutmac', mode: 'nutrients' },
  macros: { subview: 'calnutmac', mode: 'macros' },
  steps: { subview: 'steps' },
  weight: { subview: 'weight' },
  sleep: { subview: 'sleep' }
};

function switchProgressSubtab(key) {
  const target = PROGRESS_SUBNAV_MAP[key];
  if (!target) return;
  currentProgressSubtab = key;
  progressSubnavBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === key));
  progressSubviews.forEach((view) => view.classList.toggle('hidden', view.dataset.subview !== target.subview));

  if (target.mode) setCalNutMacToggle(target.mode);
  if (target.subview === 'overview') openOverviewSubtab();
  else if (target.subview === 'calnutmac') openCalNutMacSubtab();
  else if (target.subview === 'steps') openStepsSubtab();
  else if (target.subview === 'weight') openWeightSubtab();
  else if (target.subview === 'sleep') openSleepSubtab();
}

progressSubnavBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchProgressSubtab(btn.dataset.subtab));
});

// ---------- Init ----------
buildDateStrip();
buildWaterCups();
loadFoods();
applyCustomMealNames();

macrosSwapBtn.addEventListener('click', () => {
  macroCardMode = macroCardMode === 'percent' ? 'grams' : 'percent';
  macrosSwapBtn.classList.toggle('active', macroCardMode === 'grams');
  renderMacros();
});

// ---------- Day Type Selector (Rest / Work / Gym capsule) ----------
dayTypeSelectorEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.day-type-btn');
  if (!btn || !state.settings) return;
  const dayType = btn.dataset.dayType;
  if (state.settings.activeDayType === dayType) return;

  const previousDayType = state.settings.activeDayType;
  state.settings.activeDayType = dayType;
  renderDayTypeSelector();
  renderCalorieBar();
  renderMacros();

  try {
    const res = await authFetch(`${API}/settings/active-day-type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayType })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update day type');
    state.settings = data;
    renderDayTypeSelector();
    renderCalorieBar();
    renderMacros();
  } catch (err) {
    state.settings.activeDayType = previousDayType;
    renderDayTypeSelector();
    renderCalorieBar();
    renderMacros();
    showToast(err.message, true);
  }
});

profileForm.addEventListener('submit', handleProfileSubmit);

document.getElementById('weightSubmitBtn').addEventListener('click', handleWeightSubmit);
weightInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleWeightSubmit(e);
  }
});

manageGoalsBtn.addEventListener('click', () => openCoachWizard({ mode: 'manage' }));

document.getElementById('stepsSubmitBtn').addEventListener('click', handleStepsSubmit);
stepsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleStepsSubmit(e);
  }
});

sleepForm.addEventListener('submit', handleSleepSubmit);

mealCards.forEach((card) => {
  const form = card.querySelector('.inline-add-form');
  form.addEventListener('submit', (e) => handleInlineAddSubmit(e, card));

  const foodSelect = card.querySelector('.f-food');
  const gramsInput = card.querySelector('.f-grams');
  const customFields = card.querySelector('[data-role="custom-food-fields"]');
  const stateToggle = card.querySelector('[data-role="state-toggle"]');
  const customNameInput = card.querySelector('.f-custom-name');
  const customKcalInput = card.querySelector('.f-custom-kcal');
  const customProteinInput = card.querySelector('.f-custom-protein');
  const customCarbsInput = card.querySelector('.f-custom-carbs');
  const customFatInput = card.querySelector('.f-custom-fat');

  // The custom-food kcal/protein/carbs/fat fields are all "per 100g" density
  // values (see readCustomFood/updateFoodPreview), so the estimate always
  // runs on a fixed 100g mass basis — the Weight field only gates *when*
  // the estimate fires, matching the "Name + Calories + Weight all filled"
  // trigger, without corrupting the density math with the logged quantity.
  function runAutoMacroEstimate() {
    const name = customNameInput.value.trim();
    const estimate = autoEstimateMacros(name, customKcalInput.value, 100);
    if (!estimate || !gramsInput.value) return;
    customProteinInput.value = estimate.protein;
    customCarbsInput.value = estimate.carbs;
    customFatInput.value = estimate.fat;
    updateFoodPreview(card);
  }
  customNameInput.addEventListener('input', runAutoMacroEstimate);
  customKcalInput.addEventListener('input', runAutoMacroEstimate);

  // Automated Smart Nutrition Lookup Engine — once the user finishes typing a
  // custom food name (on blur), ask the server for a per-100g estimate and
  // auto-fill kcal/protein/carbs/fat. If the name carried a parseable portion
  // ("chicken breast 150g", "2 scoops whey protein", "1 medium apple") the
  // server also resolves that to a gram figure in estimate.grams; auto-fill
  // the Weight field with it (only if the user hasn't already typed their
  // own) so the density and quantity combine correctly, then recompute the
  // preview so it reflects both immediately.
  let nutritionLookupSeq = 0;
  customNameInput.addEventListener('blur', async () => {
    const name = customNameInput.value.trim();
    if (!name) return;
    const seq = ++nutritionLookupSeq;
    const estimate = await fetchNutritionEstimate(name);
    if (!estimate || seq !== nutritionLookupSeq) return;
    customKcalInput.value = estimate.kcal;
    customProteinInput.value = estimate.protein;
    customCarbsInput.value = estimate.carbs;
    customFatInput.value = estimate.fat;
    if (!gramsInput.value && estimate.grams) gramsInput.value = estimate.grams;
    updateFoodPreview(card);
  });

  foodSelect.addEventListener('change', () => {
    const isCustom = foodSelect.value === CUSTOM_FOOD_ID;
    customFields.classList.toggle('hidden', !isCustom);

    const group = FOOD_GROUPS[foodSelect.value];
    if (group) {
      foodSelect.dataset.activeState = group.defaultState;
      renderStateToggle(stateToggle, group, group.defaultState);
      stateToggle.classList.remove('hidden');
    } else {
      delete foodSelect.dataset.activeState;
      stateToggle.classList.add('hidden');
    }

    const food = isCustom ? null : resolveSelectedFood(foodSelect);
    if (food && !gramsInput.value) {
      gramsInput.value = food.unitGrams || 100;
    }
    updateFoodPreview(card);
  });

  stateToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.state-toggle-btn');
    if (!btn) return;
    const group = FOOD_GROUPS[foodSelect.value];
    if (!group || !group.states[btn.dataset.state]) return;
    foodSelect.dataset.activeState = btn.dataset.state;
    renderStateToggle(stateToggle, group, btn.dataset.state);
    updateFoodPreview(card);
  });

  gramsInput.addEventListener('input', () => {
    updateFoodPreview(card);
    runAutoMacroEstimate();
  });
  customFields.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => updateFoodPreview(card));
  });

  const scanBtn = card.querySelector('[data-role="scan-plate"]');
  const scanFileInput = card.querySelector('[data-role="scan-file-input"]');
  scanBtn.addEventListener('click', () => scanFileInput.click());
  scanFileInput.addEventListener('change', () => handleScanFileSelected(scanFileInput, card.dataset.meal));
});

closeScanBtn.addEventListener('click', closeScanModal);
cancelScanBtn.addEventListener('click', closeScanModal);
scanOverlay.addEventListener('click', (e) => { if (e.target === scanOverlay) closeScanModal(); });
confirmScanBtn.addEventListener('click', handleConfirmScan);

// ---------- Weight & Measurements modal (opened from the More tab) ----------
function openWeightMeasurementsModal() {
  profileError.textContent = '';
  applyWeightUnitUI();
  applyHeightUnitUI();
  writeHeightFieldsFromCm(state.settings?.heightCm ?? null);
  writeTargetWeightFieldFromKg(state.settings?.targetWeightKg ?? null);
  weightMeasurementsOverlay.classList.add('open');
}

function closeWeightMeasurementsModal() {
  weightMeasurementsOverlay.classList.remove('open');
}

closeWeightMeasurementsBtn.addEventListener('click', closeWeightMeasurementsModal);
weightMeasurementsOverlay.addEventListener('click', (e) => {
  if (e.target === weightMeasurementsOverlay) closeWeightMeasurementsModal();
});

// ---------- Calorie & Macro goal sliders (Goals -> Nutrition Goals) ----------
// Unlike the AI Coach wizard (which recalculates goals from body stats),
// this panel lets the user drag the calorie/carbs/protein/fat targets
// directly. Every slider drag updates state.settings in place and re-renders
// the Today tab immediately, so the app's global tracking limits (calorie
// ring, macro bars, macro panels) stay in sync as the handle moves; the
// value is persisted to the backend once the user releases the slider.
function updateMacroGoalSliderLabels() {
  macroGoalCaloriesValueEl.textContent = Number(macroGoalCaloriesSlider.value).toLocaleString();
  macroGoalCarbsValueEl.textContent = `${macroGoalCarbsSlider.value}g`;
  macroGoalProteinValueEl.textContent = `${macroGoalProteinSlider.value}g`;
  macroGoalFatValueEl.textContent = `${macroGoalFatSlider.value}g`;
}

function applyMacroGoalSlidersLocally() {
  if (!state.settings) return;
  state.settings.calorieGoal = Number(macroGoalCaloriesSlider.value);
  state.settings.macroGoals = {
    protein: Number(macroGoalProteinSlider.value),
    carbs: Number(macroGoalCarbsSlider.value),
    fat: Number(macroGoalFatSlider.value)
  };
  render();
}

async function persistMacroGoals() {
  macroGoalsError.textContent = '';
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calorieGoal: state.settings.calorieGoal,
        macroGoals: state.settings.macroGoals
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save goals');
    state.settings = data;
  } catch (err) {
    macroGoalsError.textContent = err.message;
  }
}

function populateTargetProfilesForm() {
  targetProfilesError.textContent = '';
  const dayTypeTargets = state.settings?.dayTypeTargets || {};
  for (const dayType of ['rest', 'work', 'gym']) {
    const profile = dayTypeTargets[dayType] || {};
    const inputs = targetProfileInputs[dayType];
    inputs.label.value = profile.label ?? DAY_TYPE_DEFAULT_LABELS[dayType];
    inputs.calories.value = profile.calories ?? '';
    inputs.protein.value = profile.protein ?? '';
    inputs.carbs.value = profile.carbs ?? '';
    inputs.fat.value = profile.fat ?? '';
  }
}

async function saveTargetProfiles() {
  targetProfilesError.textContent = '';
  const profiles = [];
  for (const dayType of ['rest', 'work', 'gym']) {
    const inputs = targetProfileInputs[dayType];
    const label = inputs.label.value.trim();
    const calories = Number(inputs.calories.value);
    const protein = Number(inputs.protein.value);
    const carbs = Number(inputs.carbs.value);
    const fat = Number(inputs.fat.value);
    if (!label) {
      targetProfilesError.textContent = 'Every profile needs a label.';
      return;
    }
    if ([calories, protein, carbs, fat].some((n) => Number.isNaN(n) || n <= 0)) {
      targetProfilesError.textContent = 'Calories, protein, carbs, and fat must all be positive numbers.';
      return;
    }
    profiles.push({ key: dayType, label, calories, protein, carbs, fat });
  }

  saveTargetProfilesBtn.disabled = true;
  try {
    const res = await authFetch(`${API}/settings/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save target profiles');
    state.settings = data;
    closeMacroGoalsModal();
    render();
    showToast('Target profiles saved');
  } catch (err) {
    targetProfilesError.textContent = err.message;
  } finally {
    saveTargetProfilesBtn.disabled = false;
  }
}

saveTargetProfilesBtn.addEventListener('click', saveTargetProfiles);

function openMacroGoalsModal() {
  macroGoalsError.textContent = '';
  const settings = state.settings || {};
  macroGoalCaloriesSlider.value = settings.calorieGoal ?? 2200;
  macroGoalProteinSlider.value = settings.macroGoals?.protein ?? 150;
  macroGoalCarbsSlider.value = settings.macroGoals?.carbs ?? 250;
  macroGoalFatSlider.value = settings.macroGoals?.fat ?? 70;
  updateMacroGoalSliderLabels();
  populateTargetProfilesForm();
  macroGoalsOverlay.classList.add('open');
}

function closeMacroGoalsModal() {
  macroGoalsOverlay.classList.remove('open');
}

[macroGoalCaloriesSlider, macroGoalCarbsSlider, macroGoalProteinSlider, macroGoalFatSlider].forEach((slider) => {
  slider.addEventListener('input', () => {
    updateMacroGoalSliderLabels();
    applyMacroGoalSlidersLocally();
  });
  slider.addEventListener('change', persistMacroGoals);
});

closeMacroGoalsBtn.addEventListener('click', closeMacroGoalsModal);
macroGoalsOverlay.addEventListener('click', (e) => { if (e.target === macroGoalsOverlay) closeMacroGoalsModal(); });

// ---------- Settings sub-view (nested full-screen view opened from the More tab) ----------
function openSettingsView() {
  settingsView.classList.add('open');
}

function closeSettingsView() {
  settingsView.classList.remove('open');
}

settingsBackBtn.addEventListener('click', closeSettingsView);

const SETTINGS_MENU_ACTIONS = {
  'profile-settings': () => openProfileDetailsView('settings'),
  'app-appearance': () => openSubView(appAppearanceView),
  'diary-settings': () => openDiarySettingsView(),
  'start-of-week': () => openStartOfWeekView(),
  'sharing-privacy': () => openSharingPrivacyView(),
  'my-exercises': () => openMyExercisesView(),
  'push-notifications': () => openPushNotificationsView(),
  logout: () => openLogoutConfirmModal()
};

settingsMenuListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.more-menu-item');
  if (!item) return;
  const action = SETTINGS_MENU_ACTIONS[item.dataset.menuKey];
  if (action) action();
  else showToast('Coming soon');
});

// ---------- Diary Settings sub-view (Settings > Diary Settings) ----------
function renderDiarySettings() {
  const diary = state.settings?.diary || {};
  diarySettingsListEl.querySelectorAll('[data-diary-toggle]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(Boolean(diary[btn.dataset.diaryToggle])));
  });
  defaultSearchTabValueLabelEl.textContent = SEARCH_TAB_LABELS[diary.defaultSearchTab] || 'All';
}

function openDiarySettingsView() {
  renderDiarySettings();
  openSubView(diarySettingsView);
}
diarySettingsBackBtn.addEventListener('click', () => closeSubView(diarySettingsView));

diarySettingsListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-diary-toggle]');
  if (!btn) return;
  const key = btn.dataset.diaryToggle;
  const next = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', String(next));
  const diary = { ...(state.settings.diary || {}), [key]: next };
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diary })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update diary setting');
    state.settings = data;
    if (key === 'showDecimalMacros') renderMeals();
  } catch (err) {
    btn.setAttribute('aria-checked', String(!next));
    showToast(err.message, true);
  }
});

diarySettingsListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.more-menu-item[data-menu-key]');
  if (!item) return;
  if (item.dataset.menuKey === 'default-search-tab') openDefaultSearchTabView();
  else if (item.dataset.menuKey === 'customize-meal-names') openCustomizeMealNamesView();
});

// ---------- Default Search Tab sub-page (Diary Settings > Default Search Tab) ----------
const SEARCH_TAB_LABELS = { all: 'All', 'my-foods': 'My Foods', meals: 'Meals', recipes: 'Recipes' };

function renderDefaultSearchTabRadio(value) {
  defaultSearchTabRadioListEl.querySelectorAll('.privacy-radio-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.searchTabValue === value);
  });
  defaultSearchTabValueLabelEl.textContent = SEARCH_TAB_LABELS[value] || 'All';
}

function openDefaultSearchTabView() {
  renderDefaultSearchTabRadio(state.settings?.diary?.defaultSearchTab || 'all');
  defaultSearchTabView.classList.add('open');
}
function closeDefaultSearchTabView() { defaultSearchTabView.classList.remove('open'); }
defaultSearchTabBackBtn.addEventListener('click', closeDefaultSearchTabView);

defaultSearchTabRadioListEl.addEventListener('click', async (e) => {
  const row = e.target.closest('.privacy-radio-row');
  if (!row) return;
  const previous = state.settings.diary?.defaultSearchTab || 'all';
  const value = row.dataset.searchTabValue;
  if (value === previous) return;
  renderDefaultSearchTabRadio(value);
  const diary = { ...(state.settings.diary || {}), defaultSearchTab: value };
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diary })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update default search tab');
    state.settings = data;
  } catch (err) {
    renderDefaultSearchTabRadio(previous);
    showToast(err.message, true);
  }
});

// ---------- Customize Meal Names sub-page (Diary Settings > Customize Meal Names) ----------
// Client-only override of the diary's meal-card headers; persisted to
// localStorage (not the server settings object) since it's purely a display
// preference for this device, same tier as THEME_KEY/UNIT_SYSTEM_KEY.
const MEAL_NAMES_KEY = 'pure_macros_meal_names';

function getCustomMealNames() {
  try {
    return JSON.parse(localStorage.getItem(MEAL_NAMES_KEY)) || {};
  } catch {
    return {};
  }
}

function applyCustomMealNames() {
  const names = getCustomMealNames();
  document.querySelectorAll('.meal-card[data-meal]').forEach((card) => {
    const titleEl = card.querySelector('.meal-title');
    if (!titleEl) return;
    if (!titleEl.dataset.defaultLabel) titleEl.dataset.defaultLabel = titleEl.textContent;
    titleEl.textContent = names[card.dataset.meal] || titleEl.dataset.defaultLabel;
  });
}

function renderCustomizeMealNames() {
  const names = getCustomMealNames();
  customizeMealNamesListEl.querySelectorAll('[data-meal-name-slot]').forEach((input) => {
    input.value = names[input.dataset.mealNameSlot] || '';
  });
}

function openCustomizeMealNamesView() {
  renderCustomizeMealNames();
  customizeMealNamesView.classList.add('open');
}
function closeCustomizeMealNamesView() { customizeMealNamesView.classList.remove('open'); }
customizeMealNamesBackBtn.addEventListener('click', closeCustomizeMealNamesView);

customizeMealNamesListEl.addEventListener('input', (e) => {
  const input = e.target.closest('[data-meal-name-slot]');
  if (!input) return;
  const names = getCustomMealNames();
  const value = input.value.trim();
  if (value) names[input.dataset.mealNameSlot] = value;
  else delete names[input.dataset.mealNameSlot];
  localStorage.setItem(MEAL_NAMES_KEY, JSON.stringify(names));
  applyCustomMealNames();
});

// ---------- Start of the Week sub-view (Settings > Start of the Week) ----------
function openStartOfWeekView() {
  startOfWeekSelect.value = state.settings?.weekStart || 'monday';
  openSubView(startOfWeekView);
}
startOfWeekBackBtn.addEventListener('click', () => closeSubView(startOfWeekView));

startOfWeekSelect.addEventListener('change', async () => {
  const weekStart = startOfWeekSelect.value;
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update start of week');
    state.settings = data;
    dateStripWeekStart = state.settings.weekStart;
    buildDateStrip();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Sharing & Privacy ecosystem (Settings > Sharing & Privacy) ----------
// Main list: 6 chevron rows, each opening its own full-screen sub-page
// stacked above sharingPrivacyView (see .settings-view--nested-privacy).
const SHARING_PRIVACY_MENU_ACTIONS = {
  'diary-sharing': () => openDiarySharingView(),
  'email-settings': () => openEmailSettingsView(),
  'healthkit-sharing': () => openHealthKitSharingView(),
  'facebook-settings': () => openSocialConnectView(),
  'google-settings': () => openSocialConnectView(),
  'change-password': () => openChangePasswordView()
};
sharingPrivacyMenuListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.more-menu-item');
  if (!item) return;
  const action = SHARING_PRIVACY_MENU_ACTIONS[item.dataset.menuKey];
  if (action) action();
});

function openSharingPrivacyView() {
  openSubView(sharingPrivacyView);
}
sharingPrivacyBackBtn.addEventListener('click', () => closeSubView(sharingPrivacyView));

async function persistSharing(sharing) {
  const res = await authFetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sharing })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update sharing settings');
  state.settings = data;
}

// Every sub-page below patches its own slice onto the same sharing object
// and PUTs the whole thing back, so any one screen's save can't clobber a
// field owned by another (mirrors the diary/profile-searchable pattern this
// view already used before the ecosystem grew to 6 destinations).
async function persistSharingPatch(patch) {
  const sharing = { ...(state.settings.sharing || {}), ...patch };
  await persistSharing(sharing);
}

// ---------- Diary Sharing sub-page ----------
function renderDiarySharingRadioActive(value) {
  diarySharingRadioListEl.querySelectorAll('.privacy-radio-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.diaryValue === value);
  });
}

function renderDiarySharingView() {
  const sharing = state.settings?.sharing || {};
  renderDiarySharingRadioActive(sharing.diarySharing || 'private');
  sharingProfileSearchableSwitch.setAttribute('aria-checked', String(Boolean(sharing.profileSearchable)));
}

function openDiarySharingView() {
  renderDiarySharingView();
  diarySharingView.classList.add('open');
}
function closeDiarySharingView() { diarySharingView.classList.remove('open'); }
diarySharingBackBtn.addEventListener('click', closeDiarySharingView);

diarySharingRadioListEl.addEventListener('click', async (e) => {
  const row = e.target.closest('.privacy-radio-row');
  if (!row) return;
  const previous = state.settings.sharing?.diarySharing || 'private';
  const value = row.dataset.diaryValue;
  if (value === previous) return;
  renderDiarySharingRadioActive(value);
  try {
    await persistSharingPatch({ diarySharing: value });
  } catch (err) {
    renderDiarySharingRadioActive(previous);
    showToast(err.message, true);
  }
});

sharingProfileSearchableSwitch.addEventListener('click', async () => {
  const next = sharingProfileSearchableSwitch.getAttribute('aria-checked') !== 'true';
  sharingProfileSearchableSwitch.setAttribute('aria-checked', String(next));
  try {
    await persistSharingPatch({ profileSearchable: next });
  } catch (err) {
    sharingProfileSearchableSwitch.setAttribute('aria-checked', String(!next));
    showToast(err.message, true);
  }
});

// ---------- Email Settings sub-page ----------
function renderEmailSettingsView() {
  const sharing = state.settings?.sharing || {};
  emailTokenValueEl.textContent = state.user?.username || '—';
  emailAnnouncementsSwitch.setAttribute('aria-checked', String(sharing.emailAnnouncements !== false));
  emailHealthTipsSwitch.setAttribute('aria-checked', String(sharing.emailHealthTips !== false));
  emailWeeklyDigestSwitch.setAttribute('aria-checked', String(sharing.emailWeeklyDigest !== false));
  findMeByEmailSwitch.setAttribute('aria-checked', String(Boolean(sharing.findMeByEmail)));
}

function openEmailSettingsView() {
  renderEmailSettingsView();
  emailSettingsView.classList.add('open');
}
function closeEmailSettingsView() { emailSettingsView.classList.remove('open'); }
emailSettingsBackBtn.addEventListener('click', closeEmailSettingsView);

let resendCooldownTimer;
resendConfirmationBtn.addEventListener('click', () => {
  if (resendConfirmationBtn.disabled) return;
  resendConfirmationBtn.disabled = true;
  resendConfirmationBtn.classList.add('is-loading');
  resendConfirmationBtn.innerHTML = '<span class="email-resend-spinner" aria-hidden="true"></span>';
  setTimeout(() => {
    resendConfirmationBtn.classList.remove('is-loading');
    showIosTopToast(`Verification email sent to ${emailTokenValueEl.textContent}`, '✓');
    let secondsLeft = 60;
    resendConfirmationBtn.textContent = `Sent (Resend in ${secondsLeft}s)`;
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(resendCooldownTimer);
        resendConfirmationBtn.disabled = false;
        resendConfirmationBtn.textContent = 'Resend Confirmation';
        return;
      }
      resendConfirmationBtn.textContent = `Sent (Resend in ${secondsLeft}s)`;
    }, 1000);
  }, 1200);
});

function bindEmailToggle(el, key) {
  el.addEventListener('click', async () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    try {
      await persistSharingPatch({ [key]: next });
    } catch (err) {
      el.setAttribute('aria-checked', String(!next));
      showToast(err.message, true);
    }
  });
}
bindEmailToggle(emailAnnouncementsSwitch, 'emailAnnouncements');
bindEmailToggle(emailHealthTipsSwitch, 'emailHealthTips');
bindEmailToggle(emailWeeklyDigestSwitch, 'emailWeeklyDigest');
bindEmailToggle(findMeByEmailSwitch, 'findMeByEmail');

// ---------- HealthKit Sharing sub-page ----------
function renderHealthKitSharingView() {
  const sharing = state.settings?.sharing || {};
  const syncOn = Boolean(sharing.healthKitSync);
  healthKitSyncSwitch.setAttribute('aria-checked', String(syncOn));
  healthKitEnergyBurnSwitch.setAttribute('aria-checked', String(sharing.healthKitEnergyBurn !== false));
  healthKitMacrosSwitch.setAttribute('aria-checked', String(sharing.healthKitMacros !== false));
  healthKitBodyWeightSwitch.setAttribute('aria-checked', String(sharing.healthKitBodyWeight !== false));
  healthKitSubListEl.classList.toggle('healthkit-sublist-disabled', !syncOn);
}

function openHealthKitSharingView() {
  renderHealthKitSharingView();
  healthKitSharingView.classList.add('open');
}
function closeHealthKitSharingView() { healthKitSharingView.classList.remove('open'); }
healthKitBackBtn.addEventListener('click', closeHealthKitSharingView);

healthKitSyncSwitch.addEventListener('click', async () => {
  const next = healthKitSyncSwitch.getAttribute('aria-checked') !== 'true';
  healthKitSyncSwitch.setAttribute('aria-checked', String(next));

  if (!next) {
    healthKitSubListEl.classList.add('healthkit-sublist-disabled');
    try {
      await persistSharingPatch({ healthKitSync: false });
    } catch (err) {
      healthKitSyncSwitch.setAttribute('aria-checked', 'true');
      healthKitSubListEl.classList.remove('healthkit-sublist-disabled');
      showToast(err.message, true);
    }
    return;
  }

  healthKitConnectingOverlay.classList.add('open');
  try {
    await persistSharingPatch({
      healthKitSync: true,
      healthKitEnergyBurn: true,
      healthKitMacros: true,
      healthKitBodyWeight: true
    });
    setTimeout(() => {
      healthKitConnectingOverlay.classList.remove('open');
      healthKitEnergyBurnSwitch.setAttribute('aria-checked', 'true');
      healthKitMacrosSwitch.setAttribute('aria-checked', 'true');
      healthKitBodyWeightSwitch.setAttribute('aria-checked', 'true');
      healthKitSubListEl.classList.remove('healthkit-sublist-disabled');
      showIosTopToast('Apple Health connected successfully!', '✓');
    }, 1500);
  } catch (err) {
    healthKitConnectingOverlay.classList.remove('open');
    healthKitSyncSwitch.setAttribute('aria-checked', 'false');
    healthKitSubListEl.classList.add('healthkit-sublist-disabled');
    showToast(err.message, true);
  }
});

function bindHealthKitToggle(el, key) {
  el.addEventListener('click', async () => {
    if (healthKitSubListEl.classList.contains('healthkit-sublist-disabled')) return;
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    try {
      await persistSharingPatch({ [key]: next });
    } catch (err) {
      el.setAttribute('aria-checked', String(!next));
      showToast(err.message, true);
    }
  });
}
bindHealthKitToggle(healthKitEnergyBurnSwitch, 'healthKitEnergyBurn');
bindHealthKitToggle(healthKitMacrosSwitch, 'healthKitMacros');
bindHealthKitToggle(healthKitBodyWeightSwitch, 'healthKitBodyWeight');

// ---------- Social Connect sub-page (Facebook Settings + Google Settings) ----------
function renderSocialConnectView() {
  const sharing = state.settings?.sharing || {};
  connectFacebookBtn.textContent = sharing.facebookConnected ? 'Connected to Facebook ✓' : 'Connect to Facebook';
  connectFacebookBtn.classList.toggle('is-connected', Boolean(sharing.facebookConnected));
  connectGoogleBtn.textContent = sharing.googleConnected ? 'Connected with Google ✓' : 'Continue with Google';
  connectGoogleBtn.classList.toggle('is-connected', Boolean(sharing.googleConnected));
}

function openSocialConnectView() {
  renderSocialConnectView();
  socialConnectView.classList.add('open');
}
function closeSocialConnectView() { socialConnectView.classList.remove('open'); }
socialConnectBackBtn.addEventListener('click', closeSocialConnectView);

function bindSocialConnectButton(el, key) {
  el.addEventListener('click', async () => {
    const next = !(state.settings.sharing || {})[key];
    try {
      await persistSharingPatch({ [key]: next });
      renderSocialConnectView();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
bindSocialConnectButton(connectFacebookBtn, 'facebookConnected');
bindSocialConnectButton(connectGoogleBtn, 'googleConnected');

// ---------- Change Password sub-page ----------
function updateChangePasswordButtonState() {
  const valid = newPasswordInput.value.length >= 10 && newPasswordInput.value === confirmNewPasswordInput.value;
  changePasswordSubmitBtn.classList.toggle('is-disabled', !valid);
  changePasswordSubmitBtn.disabled = !valid;
  return valid;
}
newPasswordInput.addEventListener('input', updateChangePasswordButtonState);
confirmNewPasswordInput.addEventListener('input', updateChangePasswordButtonState);

function openChangePasswordView() {
  currentPasswordInput.value = '';
  newPasswordInput.value = '';
  confirmNewPasswordInput.value = '';
  changePasswordError.textContent = '';
  updateChangePasswordButtonState();
  changePasswordView.classList.add('open');
}
function closeChangePasswordView() { changePasswordView.classList.remove('open'); }
changePasswordBackBtn.addEventListener('click', closeChangePasswordView);

changePasswordSubmitBtn.addEventListener('click', async () => {
  if (!updateChangePasswordButtonState()) return;
  changePasswordError.textContent = '';
  changePasswordSubmitBtn.disabled = true;
  try {
    const res = await authFetch(`${API}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPasswordInput.value, newPassword: newPasswordInput.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to change password');
    showToast('Password updated');
    closeChangePasswordView();
  } catch (err) {
    changePasswordError.textContent = err.message;
    changePasswordSubmitBtn.disabled = false;
  }
});

// ---------- My Exercises sub-view (Settings > My Exercises) ----------
async function loadCustomExercises() {
  try {
    const res = await authFetch(`${API}/custom-exercises`);
    if (!res.ok) throw new Error('Failed to load custom exercises');
    state.customExercises = await res.json();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderCustomExercises() {
  myExercisesListEl.innerHTML = '';
  const list = state.customExercises || [];
  myExercisesEmptyEl.classList.toggle('hidden', list.length > 0);
  for (const ex of list) {
    const li = document.createElement('li');
    li.className = 'weight-entry';
    li.innerHTML = `
      <span class="weight-date">${escapeHtml(ex.name)}</span>
      <span class="weight-value">${ex.caloriesPerMinute} kcal/min</span>
      <button type="button" class="icon-btn" data-delete-exercise="${ex.id}" aria-label="Delete ${escapeHtml(ex.name)}">✕</button>
    `;
    myExercisesListEl.appendChild(li);
  }
}

async function openMyExercisesView() {
  await loadCustomExercises();
  renderCustomExercises();
  openSubView(myExercisesView);
}
myExercisesBackBtn.addEventListener('click', () => closeSubView(myExercisesView));

myExercisesListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-exercise]');
  if (!btn) return;
  const id = btn.dataset.deleteExercise;
  try {
    const res = await authFetch(`${API}/custom-exercises/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete exercise');
    state.customExercises = state.customExercises.filter((ex) => ex.id !== id);
    renderCustomExercises();
  } catch (err) {
    showToast(err.message, true);
  }
});

function openAddCustomExerciseModal() {
  customExerciseError.textContent = '';
  addCustomExerciseForm.reset();
  addCustomExerciseOverlay.classList.add('open');
}
function closeAddCustomExerciseModalFn() {
  addCustomExerciseOverlay.classList.remove('open');
}
addCustomExerciseBtn.addEventListener('click', openAddCustomExerciseModal);
closeAddCustomExerciseModal.addEventListener('click', closeAddCustomExerciseModalFn);
cancelAddCustomExercise.addEventListener('click', closeAddCustomExerciseModalFn);
addCustomExerciseOverlay.addEventListener('click', (e) => { if (e.target === addCustomExerciseOverlay) closeAddCustomExerciseModalFn(); });

addCustomExerciseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  customExerciseError.textContent = '';
  const name = customExerciseNameInput.value.trim();
  const caloriesPerMinute = parseFloat(customExerciseCaloriesInput.value);
  if (!name || Number.isNaN(caloriesPerMinute) || caloriesPerMinute <= 0) {
    customExerciseError.textContent = 'Enter a name and a positive calories/minute value';
    return;
  }
  try {
    const res = await authFetch(`${API}/custom-exercises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, caloriesPerMinute })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add exercise');
    state.customExercises = [...(state.customExercises || []), data];
    renderCustomExercises();
    closeAddCustomExerciseModalFn();
  } catch (err) {
    customExerciseError.textContent = err.message;
  }
});

// ---------- Push Notifications sub-view (Settings > Push Notifications) ----------
// The system permission itself is simulated (see #mockDeviceSettingsOverlay
// below) rather than requested through the real Notification API, so the
// banner's on/off state lives in localStorage instead of Notification.permission.
function isPushNotificationsAllowed() {
  return localStorage.getItem('push_notifications_enabled') === 'true';
}

function renderPushNotifications() {
  const notifications = state.settings?.notifications || {};
  pushNotificationsView.querySelectorAll('[data-notif-key]').forEach((box) => {
    box.checked = Boolean(notifications[box.dataset.notifKey]);
    box.disabled = !isPushNotificationsAllowed();
  });
  quietHoursTimeRow.hidden = !notifications.quietHours;
  quietHoursStartInput.value = localStorage.getItem('quiet_hours_start') || '22:00';
  quietHoursEndInput.value = localStorage.getItem('quiet_hours_end') || '07:00';
  notifDisabledBanner.hidden = isPushNotificationsAllowed();
  pushNotifRowsList.classList.toggle('notif-rows-disabled', !isPushNotificationsAllowed());
}

// Scale-check "pop" animation cascading down the 6 notification rows once
// push permission is granted from the mock system settings pane.
function playNotifRowsEnableAnimation() {
  const rows = pushNotifRowsList.querySelectorAll(':scope > .more-menu-item');
  rows.forEach((row, i) => {
    row.style.animationDelay = `${i * 45}ms`;
    row.classList.add('notif-row-pop');
  });
  setTimeout(() => {
    rows.forEach((row) => {
      row.classList.remove('notif-row-pop');
      row.style.animationDelay = '';
    });
  }, 400 + rows.length * 45);
}

async function openPushNotificationsView() {
  try {
    const res = await authFetch(`${API}/settings`);
    const data = await res.json();
    if (res.ok) state.settings = data;
  } catch {
    // Fall back to whatever settings are already cached in state.
  }
  renderPushNotifications();
  openSubView(pushNotificationsView);
}
pushNotificationsBackBtn.addEventListener('click', () => closeSubView(pushNotificationsView));

pushNotificationsView.addEventListener('change', async (e) => {
  const box = e.target.closest('[data-notif-key]');
  if (!box) return;
  const key = box.dataset.notifKey;
  localStorage.setItem(`notif_${key}`, String(box.checked));
  if (key === 'quietHours') quietHoursTimeRow.hidden = !box.checked;
  try {
    const res = await authFetch(`${API}/settings/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: box.checked })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update notification setting');
    state.settings = data;
  } catch (err) {
    box.checked = !box.checked;
    localStorage.setItem(`notif_${key}`, String(box.checked));
    if (key === 'quietHours') quietHoursTimeRow.hidden = !box.checked;
    showToast(err.message, true);
  }
});

quietHoursStartInput.addEventListener('change', () => localStorage.setItem('quiet_hours_start', quietHoursStartInput.value));
quietHoursEndInput.addEventListener('change', () => localStorage.setItem('quiet_hours_end', quietHoursEndInput.value));

// ---------- Simulated iOS System Settings pop-up (banner "Settings" link) ----------
function openMockDeviceSettings() {
  mockAllowNotificationsSwitch.setAttribute('aria-checked', String(isPushNotificationsAllowed()));
  mockDeviceSettingsOverlay.classList.add('open');
}
function closeMockDeviceSettingsFn() {
  mockDeviceSettingsOverlay.classList.remove('open');
}
notifBannerSettingsLink.addEventListener('click', openMockDeviceSettings);
closeMockDeviceSettings.addEventListener('click', closeMockDeviceSettingsFn);
mockDeviceSettingsOverlay.addEventListener('click', (e) => {
  if (e.target === mockDeviceSettingsOverlay) closeMockDeviceSettingsFn();
});

mockAllowNotificationsSwitch.addEventListener('click', () => {
  const next = mockAllowNotificationsSwitch.getAttribute('aria-checked') !== 'true';
  mockAllowNotificationsSwitch.setAttribute('aria-checked', String(next));
  localStorage.setItem('push_notifications_enabled', String(next));
  if (next) {
    closeMockDeviceSettingsFn();
    notifDisabledBanner.classList.add('fading-out');
    setTimeout(() => {
      notifDisabledBanner.hidden = true;
      notifDisabledBanner.classList.remove('fading-out');
    }, 350);
    pushNotificationsView.querySelectorAll('[data-notif-key]').forEach((box) => { box.disabled = false; });
    pushNotifRowsList.classList.remove('notif-rows-disabled');
    playNotifRowsEnableAnimation();
  } else {
    pushNotificationsView.querySelectorAll('[data-notif-key]').forEach((box) => { box.disabled = true; });
    pushNotifRowsList.classList.add('notif-rows-disabled');
  }
});

// ---------- Logout confirmation modal (Settings > Logout) ----------
function openLogoutConfirmModal() {
  logoutConfirmOverlay.classList.add('open');
}
function closeLogoutConfirmModalFn() {
  logoutConfirmOverlay.classList.remove('open');
}
closeLogoutConfirmModal.addEventListener('click', closeLogoutConfirmModalFn);
cancelLogoutConfirm.addEventListener('click', closeLogoutConfirmModalFn);
logoutConfirmOverlay.addEventListener('click', (e) => { if (e.target === logoutConfirmOverlay) closeLogoutConfirmModalFn(); });
confirmLogoutBtn.addEventListener('click', () => handleLogout());

// ---------- Goals sub-view (nested full-screen view opened from the More tab) ----------
const ACTIVITY_LEVEL_LABELS = {
  sedentary: 'Sedentary',
  light: 'Lightly Active',
  moderate: 'Moderately Active',
  very: 'Very Active',
  extreme: 'Extremely Active'
};

// Weight is stored server-side in kg; the Goals view always displays it in
// stone + pounds regardless of the app-wide kg/lbs unit toggle.
function formatWeightStLbs(kg) {
  const totalLbs = kgToLbs(kg);
  const stone = Math.floor(totalLbs / 14);
  const lbs = Math.round(totalLbs - stone * 14);
  return `${stone} st, ${lbs} lbs`;
}

function formatDateUK(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function renderGoalsView() {
  const chronological = [...(state.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  const starting = chronological[0];
  const current = chronological[chronological.length - 1];
  goalsStartingWeightEl.textContent = starting
    ? `${formatWeightStLbs(starting.weight)} on ${formatDateUK(starting.date)}`
    : 'Not logged yet';
  goalsCurrentWeightEl.textContent = current
    ? `${formatWeightStLbs(current.weight)} on ${formatDateUK(current.date)}`
    : 'Not logged yet';

  const settings = state.settings || {};
  goalsTargetWeightEl.textContent = settings.targetWeightKg ? formatWeightStLbs(settings.targetWeightKg) : 'Not set';
  goalsWeeklyGoalEl.textContent = `${settings.weeklyGoalLbs ?? 1} lbs/week`;
  goalsActivityLevelEl.textContent = ACTIVITY_LEVEL_LABELS[settings.activityLevel] || 'Moderately Active';
  goalsWorkoutsPerWeekEl.textContent = settings.workoutsPerWeek ?? 3;
  goalsMinutesPerWorkoutEl.textContent = settings.minutesPerWorkout ?? 45;
}

function openGoalsView() {
  renderGoalsView();
  openSubView(goalsView);
}

function closeGoalsView() {
  closeSubView(goalsView);
}

goalsBackBtn.addEventListener('click', closeGoalsView);

// ---------- iOS-style 3D snap drum wheel picker (Goals -> Workouts/Week & Minutes/Workout) ----------
// Reuses the buildWheelColumn/scrollWheelToIndex/getWheelSelectedIndex/
// highlightWheelSelection helpers defined below for the Add Weight sheet —
// they're generic over any .wheel-col element, just with a single full-width
// column here instead of three narrow ones.
const GOAL_WHEEL_FIELDS = {
  workoutsPerWeek: {
    title: 'Workouts / Week',
    values: Array.from({ length: 29 }, (_, i) => i), // 0-28
    format: (v) => String(v),
    fallback: 3
  },
  minutesPerWorkout: {
    title: 'Minutes / Workout',
    values: Array.from({ length: 361 }, (_, i) => i), // 0-360 in 1-minute increments
    format: (v) => `${v} min`,
    fallback: 45
  }
};

let activeGoalWheelField = null;

function openGoalWheelPicker(field) {
  const config = GOAL_WHEEL_FIELDS[field];
  if (!config) return;
  activeGoalWheelField = field;
  iosWheelPickerTitle.textContent = config.title;
  buildWheelColumn(iosWheelPickerTrack, config.values, config.format);
  const current = state.settings?.[field] ?? config.fallback;
  scrollWheelToIndex(iosWheelPickerTrack, Math.max(0, Math.min(config.values.length - 1, current)));
  highlightWheelSelection(iosWheelPickerTrack);
  iosWheelPickerSheet.classList.add('open');
}

function closeGoalWheelPicker() {
  iosWheelPickerSheet.classList.remove('open');
  activeGoalWheelField = null;
}

goalsWorkoutsPerWeekRow.addEventListener('click', () => openGoalWheelPicker('workoutsPerWeek'));
goalsMinutesPerWorkoutRow.addEventListener('click', () => openGoalWheelPicker('minutesPerWorkout'));
iosWheelPickerCloseBtn.addEventListener('click', closeGoalWheelPicker);
iosWheelPickerBackdrop.addEventListener('click', closeGoalWheelPicker);
setupWheelScrollHighlight(iosWheelPickerTrack);

iosWheelPickerSaveBtn.addEventListener('click', async () => {
  const field = activeGoalWheelField;
  const config = GOAL_WHEEL_FIELDS[field];
  if (!field || !config) return;
  const idx = Math.max(0, Math.min(config.values.length - 1, getWheelSelectedIndex(iosWheelPickerTrack)));
  const value = config.values[idx];
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update goal');
    state.settings = data;
    localStorage.setItem(`goal_${field}`, String(value));
    closeGoalWheelPicker();
    requestAnimationFrame(() => renderGoalsView());
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Additional Nutrient Goals sub-view (nested full-screen view, opened from Goals) ----------
// Daily Value-style reference targets (FDA 2016 label update), keyed the same
// way as NUTRIENT_LABELS/NUTRIENT_UNITS so today's logged totals can be
// compared against a target on a matching unit.
const ADDITIONAL_NUTRIENT_KEYS = ['potassium', 'sodium', 'iron', 'sugar', 'vitaminA', 'vitaminC', 'vitaminD', 'vitaminB12'];
const NUTRIENT_GOALS = {
  potassium: 4700, sodium: 2300, iron: 18, sugar: 50,
  vitaminA: 900, vitaminC: 90, vitaminD: 20, vitaminB12: 2.4
};

function computeAdditionalNutrientTotals(entries) {
  const totals = {};
  for (const key of ADDITIONAL_NUTRIENT_KEYS) totals[key] = 0;
  for (const e of entries) {
    for (const key of ADDITIONAL_NUTRIENT_KEYS) totals[key] += e[key] || 0;
  }
  return totals;
}

function renderNutrientGoalsView() {
  const totals = computeAdditionalNutrientTotals(state.entries || []);
  nutrientGoalsListEl.innerHTML = '';
  for (const key of ADDITIONAL_NUTRIENT_KEYS) {
    const total = Math.round(totals[key] * 10) / 10;
    const li = document.createElement('li');
    li.className = 'nutrient-row';
    li.innerHTML = `<span class="nutrient-name">${NUTRIENT_LABELS[key]}</span><span class="nutrient-value">${total} / ${NUTRIENT_GOALS[key]}${NUTRIENT_UNITS[key]}</span>`;
    nutrientGoalsListEl.appendChild(li);
  }
}

function openNutrientGoalsView() {
  renderNutrientGoalsView();
  nutrientGoalsView.classList.add('open');
}

function closeNutrientGoalsView() {
  nutrientGoalsView.classList.remove('open');
}

nutrientGoalsBackBtn.addEventListener('click', closeNutrientGoalsView);

const GOALS_MENU_ACTIONS = {
  'calorie-macro-goals': () => openMacroGoalsModal(),
  'additional-nutrient-goals': () => openNutrientGoalsView()
};

nutritionGoalsMenuListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.more-menu-item');
  if (!item) return;
  const action = GOALS_MENU_ACTIONS[item.dataset.menuKey];
  if (action) action();
  else showToast('Coming soon');
});

// ---------- Global "+" Food Logging Overlay ----------
function openLogOverlay() {
  logQuickAddError.textContent = '';
  logQuickAddForm.reset();
  logQuickAddForm.classList.add('hidden');
  logSearchInput.value = '';
  switchLogSubtab('history');
  refreshLogOverlayLists();
  // Diary Settings > "Enable Quick-Add Calorie Button"
  document.getElementById('logFeatureQuickAdd').classList.toggle('hidden', !state.settings?.diary?.quickAddEnabled);
  // Same display:none enforcement as openSubView: physically removes the
  // dashboard tab sitting behind this overlay from rendering instead of
  // just sitting under it at opacity 1, which is what let its text bleed
  // through the solid overlay sheet.
  const base = currentBase();
  if (base) base.classList.add('subview-covered');
  logOverlay.classList.add('open');
}

function closeLogOverlay() {
  logOverlay.classList.remove('open');
  const base = currentBase();
  if (base) base.classList.remove('subview-covered');
}

fabLogBtn.addEventListener('click', openLogOverlay);
closeLogOverlayBtn.addEventListener('click', closeLogOverlay);
logOverlay.addEventListener('click', (e) => { if (e.target === logOverlay) closeLogOverlay(); });

function switchLogSubtab(key) {
  currentLogSubtab = key;
  logSubtabsEl.querySelectorAll('.log-subtab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.logSubtab === key));
  [logPanelHistory, logPanelMeals, logPanelRecipes, logPanelFoods].forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.logPanel !== key);
  });
  renderLogSubtabPanel(key);
}

logSubtabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.log-subtab-btn');
  if (!btn) return;
  switchLogSubtab(btn.dataset.logSubtab);
});

logSearchInput.addEventListener('input', () => {
  clearTimeout(globalFoodSearchTimer);
  if (currentLogSubtab !== 'foods') switchLogSubtab('foods');
  else renderLogSubtabPanel('foods');
});

function renderEmptyLogPanel(panelEl, message) {
  panelEl.innerHTML = `<li class="empty-state">${escapeHtml(message)}</li>`;
}

function renderLogSimpleList(panelEl, items, mapFn, emptyMessage) {
  panelEl.innerHTML = '';
  if (items.length === 0) {
    renderEmptyLogPanel(panelEl, emptyMessage);
    return;
  }
  for (const raw of items) {
    const item = mapFn(raw);
    if (!item.foodId) continue;
    const li = document.createElement('li');
    li.className = 'log-food-row';
    li.innerHTML = `
      <div class="log-food-row-left">
        <span class="log-food-check" aria-hidden="true">✓</span>
        <div class="log-food-row-text">
          <span class="log-food-name">${escapeHtml(item.name)}</span>
          <span class="log-food-meta">${escapeHtml(item.meta || '')}</span>
        </div>
      </div>
      <button type="button" class="log-food-add-btn" aria-label="Add ${escapeHtml(item.name)}">+</button>
    `;
    li.addEventListener('click', () => quickAddFromFoodId(item.foodId, item.grams));
    panelEl.appendChild(li);
  }
}

function getLocalFoodRows(query) {
  const seenGroups = new Set();
  const rows = [];
  for (const food of state.foods) {
    if (food.group) {
      if (seenGroups.has(food.group)) continue;
      seenGroups.add(food.group);
      const label = FOOD_GROUPS[food.group]?.groupLabel || food.name;
      if (query && !label.toLowerCase().includes(query)) continue;
      rows.push({ name: label, meta: 'raw or cooked', foodId: food.group });
      continue;
    }
    if (query && !food.name.toLowerCase().includes(query)) continue;
    rows.push({ name: food.name, meta: `${food.kcal} cal, 100 g`, foodId: food.id });
  }
  return rows;
}

// Hits the server's live universal nutrition search (Open Food Facts) so any
// real food on earth — not just the local reference list — can be found by
// name and logged at whatever gram weight the user enters. Matches are
// cached client-side in externalFoodCache so selecting one later doesn't
// need another round trip.
async function fetchGlobalFoodRows(query) {
  try {
    const res = await fetch(`${API}/foods/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const foods = await res.json();
    return foods.map((food) => {
      externalFoodCache.set(food.id, food);
      return {
        name: food.name,
        meta: `${food.kcal} cal · P ${food.protein}g C ${food.carbs}g F ${food.fat}g · per 100g · global`,
        foodId: food.id
      };
    });
  } catch {
    return [];
  }
}

function renderLogSubtabPanel(key) {
  if (key === 'history') {
    const todays = state.entries.slice().reverse();
    renderLogSimpleList(
      logPanelHistory,
      todays,
      (e) => ({ name: e.name, meta: `${e.calories} cal${e.grams ? `, ${e.grams} g` : ''}`, foodId: e.foodId, grams: e.grams }),
      'Nothing logged for this day yet.'
    );
  } else if (key === 'foods') {
    const rawQuery = logSearchInput.value.trim();
    const localRows = getLocalFoodRows(rawQuery.toLowerCase());
    renderLogSimpleList(
      logPanelFoods,
      localRows,
      (r) => r,
      rawQuery ? 'Searching the global food database…' : 'Type to search any food on earth.'
    );

    clearTimeout(globalFoodSearchTimer);
    if (rawQuery.length >= 2) {
      globalFoodSearchTimer = setTimeout(async () => {
        const globalRows = await fetchGlobalFoodRows(rawQuery);
        // Stale response guard: ignore results for a query the user has
        // since changed or cleared while the request was in flight.
        if (logSearchInput.value.trim() !== rawQuery || currentLogSubtab !== 'foods') return;
        renderLogSimpleList(logPanelFoods, [...localRows, ...globalRows], (r) => r, 'No foods match your search.');
      }, 400);
    }
  } else if (key === 'meals') {
    renderEmptyLogPanel(logPanelMeals, 'No saved meals yet — meals you save from your log will show up here.');
  } else if (key === 'recipes') {
    renderEmptyLogPanel(logPanelRecipes, 'No saved recipes yet — build a recipe from your food log to see it here.');
  }
}

// Clicking any food row in History/My Foods/Recently Logged/Most Popular
// jumps straight into the Quick Add mini-form with that food (and its
// raw/cooked state, if any) pre-selected.
function quickAddFromFoodId(foodId, grams) {
  const groupEntry = Object.entries(FOOD_GROUPS).find(([, g]) => Object.values(g.states).includes(foodId));
  if (groupEntry) {
    const [groupKey, group] = groupEntry;
    logQuickAddFood.value = groupKey;
    const stateName = Object.entries(group.states).find(([, id]) => id === foodId)?.[0] || group.defaultState;
    logQuickAddFood.dataset.activeState = stateName;
  } else if (externalFoodCache.has(foodId)) {
    // A <select> silently ignores .value assignments that don't match an
    // existing <option>, so a food from the global search needs one
    // inserted before it can actually be selected.
    ensureExternalFoodOption(logQuickAddFood, externalFoodCache.get(foodId));
    logQuickAddFood.value = foodId;
    delete logQuickAddFood.dataset.activeState;
  } else {
    logQuickAddFood.value = foodId;
    delete logQuickAddFood.dataset.activeState;
  }
  logQuickAddGrams.value = grams || '';
  logQuickAddForm.classList.remove('hidden');
  logQuickAddFood.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ensureExternalFoodOption(selectEl, food) {
  if (selectEl.querySelector(`option[value="${food.id}"]`)) return;
  const option = document.createElement('option');
  option.value = food.id;
  option.textContent = food.name;
  selectEl.insertBefore(option, selectEl.firstChild);
}

// Recently Logged: last 5 entries logged today, most recent first.
// Most Popular Meals: foods logged most often today, ranked by count — the
// app only keeps today's entries client-side, so "today" is the frequency
// signal available here rather than an all-time tally.
function refreshLogOverlayLists() {
  const recent = [...state.entries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5);
  renderLogSimpleList(
    logRecentList,
    recent,
    (e) => ({ name: e.name, meta: `${e.calories} cal${e.grams ? `, ${e.grams} g` : ''}`, foodId: e.foodId, grams: e.grams }),
    'Nothing logged yet today.'
  );

  const counts = new Map();
  for (const e of state.entries) {
    const key = e.foodId === CUSTOM_FOOD_ID ? e.name : e.foodId;
    const existing = counts.get(key) || { name: e.name, foodId: e.foodId, grams: e.grams, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  const popular = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  renderLogSimpleList(
    logPopularList,
    popular,
    (p) => ({ name: p.name, meta: `${p.count}x today`, foodId: p.foodId, grams: p.grams }),
    'Log a few meals to see your most popular picks.'
  );

  if (logOverlay.classList.contains('open') && currentLogSubtab === 'history') renderLogSubtabPanel('history');
}

// ---------- Feature module grid (Barcode / Voice / Meal Scan / Quick Add) ----------
document.getElementById('logFeatureBarcode').addEventListener('click', () => {
  openBarcodeScanModal();
});
document.getElementById('logFeatureVoice').addEventListener('click', () => {
  openVoiceLogSheet();
});
document.getElementById('logFeatureMealScan').addEventListener('click', () => {
  logMealScanFileInput.click();
});

// ---------- Barcode Scan modal ----------
async function openBarcodeScanModal() {
  barcodeError.textContent = '';
  barcodeHint.classList.remove('hidden');
  barcodeScanOverlay.classList.add('open');
  try {
    barcodeMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    barcodeVideo.srcObject = barcodeMediaStream;
  } catch (err) {
    barcodeError.textContent =
      err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Camera access was denied. Allow camera permission to scan a barcode.'
        : 'Could not start the camera on this device.';
  }
}
function closeBarcodeScanModal() {
  barcodeScanOverlay.classList.remove('open');
  if (barcodeMediaStream) {
    barcodeMediaStream.getTracks().forEach((track) => track.stop());
    barcodeMediaStream = null;
  }
  barcodeVideo.srcObject = null;
}
closeBarcodeScanBtn.addEventListener('click', closeBarcodeScanModal);
barcodeScanOverlay.addEventListener('click', (e) => {
  if (e.target === barcodeScanOverlay) closeBarcodeScanModal();
});

// ---------- Voice Log bottom sheet ----------
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function openVoiceLogSheet() {
  voiceLogError.textContent = '';
  voiceLogFinalTranscript = '';
  voiceLogPreviewText.textContent = 'Tap the mic and describe what you ate.';
  voiceLogSheet.classList.add('open');
}
function closeVoiceLogSheet() {
  stopVoiceLogListening();
  voiceLogSheet.classList.remove('open');
}
function stopVoiceLogListening() {
  voiceLogListening = false;
  voiceLogMicBtn.classList.remove('listening');
  if (voiceLogRecognition) voiceLogRecognition.stop();
}

function startVoiceLogListening() {
  if (!SpeechRecognitionCtor) {
    voiceLogError.textContent = 'Voice recognition is not supported in this browser.';
    return;
  }
  voiceLogError.textContent = '';
  voiceLogFinalTranscript = '';
  voiceLogRecognition = new SpeechRecognitionCtor();
  voiceLogRecognition.continuous = true;
  voiceLogRecognition.interimResults = true;
  voiceLogRecognition.lang = 'en-US';

  voiceLogRecognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) voiceLogFinalTranscript += `${transcript} `;
      else interim += transcript;
    }
    voiceLogPreviewText.textContent = (voiceLogFinalTranscript + interim).trim() || 'Listening…';
  };
  voiceLogRecognition.onerror = (event) => {
    voiceLogError.textContent =
      event.error === 'not-allowed' || event.error === 'permission-denied'
        ? 'Microphone access was denied. Allow microphone permission to use voice log.'
        : 'Voice recognition ran into an error.';
    stopVoiceLogListening();
  };
  voiceLogRecognition.onend = () => {
    voiceLogListening = false;
    voiceLogMicBtn.classList.remove('listening');
    const transcript = sanitizeToEnglishAscii(voiceLogFinalTranscript);
    if (transcript) {
      logSearchInput.value = transcript;
      switchLogSubtab('foods');
      voiceLogSheet.classList.remove('open');
    }
  };

  voiceLogListening = true;
  voiceLogMicBtn.classList.add('listening');
  voiceLogRecognition.start();
}

voiceLogMicBtn.addEventListener('click', () => {
  if (voiceLogListening) stopVoiceLogListening();
  else startVoiceLogListening();
});
voiceLogSheet.addEventListener('click', (e) => {
  if (e.target === voiceLogSheet) closeVoiceLogSheet();
});

// Pull-down-to-dismiss, mirroring the Add Exercise sheet's swipe gesture.
(function setupVoiceLogSheetSwipe() {
  let startY = null;
  let currentDy = 0;

  function onStart(e) {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    voiceLogSheetPanel.classList.add('dragging');
  }
  function onMove(e) {
    if (startY === null) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    currentDy = Math.max(0, y - startY);
    voiceLogSheetPanel.style.transform = `translateY(${currentDy}px)`;
  }
  function onEnd() {
    if (startY === null) return;
    voiceLogSheetPanel.classList.remove('dragging');
    voiceLogSheetPanel.style.transform = '';
    if (currentDy > 80) closeVoiceLogSheet();
    startY = null;
    currentDy = 0;
  }

  voiceLogGrabber.addEventListener('touchstart', onStart, { passive: true });
  voiceLogGrabber.addEventListener('touchmove', onMove, { passive: true });
  voiceLogGrabber.addEventListener('touchend', onEnd);
  voiceLogGrabber.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
})();

// ---------- Quick Add full screen ----------
function openQuickAddScreen() {
  quickAddError.textContent = '';
  quickAddCaloriesInput.value = '';
  quickAddFatInput.value = '';
  quickAddCarbsInput.value = '';
  quickAddProteinInput.value = '';
  quickAddMealSelect.value = logMealSelect.value || 'breakfast';
  const now = new Date();
  quickAddTimeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  quickAddScreen.classList.add('open');
}
function closeQuickAddScreen() {
  quickAddScreen.classList.remove('open');
}
quickAddBackBtn.addEventListener('click', closeQuickAddScreen);

quickAddSaveBtn.addEventListener('click', async () => {
  quickAddError.textContent = '';
  const kcal = Number(quickAddCaloriesInput.value);
  const fat = Number(quickAddFatInput.value) || 0;
  const carbs = Number(quickAddCarbsInput.value) || 0;
  const protein = Number(quickAddProteinInput.value) || 0;
  if (!kcal || kcal <= 0) {
    quickAddError.textContent = 'Enter a calorie amount';
    return;
  }
  try {
    // Quick Add logs a one-off entry with no food-database lookup, so the
    // typed macros are sent as a custom food's per-100g baseline with
    // grams pinned to 100 — the grams/100 multiplier becomes a no-op and
    // the server stores the totals exactly as entered.
    const res = await authFetch(`${API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        meal: quickAddMealSelect.value,
        foodId: CUSTOM_FOOD_ID,
        grams: 100,
        customFood: { name: 'Quick Add', kcal, protein, carbs, fat }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add food');
    state.entries.push(data);
    render();
    refreshStreak();
    closeQuickAddScreen();
    closeLogOverlay();
    showToast(`Added ${data.name}`);
  } catch (err) {
    quickAddError.textContent = err.message;
  }
});

// ---------- Bottom utility dock (Water / Weight / Exercise) ----------
document.getElementById('logRecentFilterBtn').addEventListener('click', () => {
  showToast('Filters are coming soon');
});
document.getElementById('logDockWater').addEventListener('click', () => {
  openAddWaterScreen();
});
document.getElementById('logDockWeight').addEventListener('click', () => {
  openAddWeightScreen();
});
document.getElementById('logDockExercise').addEventListener('click', () => {
  openAddExerciseSheet();
});
logMealScanFileInput.addEventListener('change', () => {
  const meal = logMealSelect.value;
  handleScanFileSelected(logMealScanFileInput, meal);
  closeLogOverlay();
});
document.getElementById('logFeatureQuickAdd').addEventListener('click', () => {
  openQuickAddScreen();
});

logQuickAddFood.addEventListener('change', () => {
  delete logQuickAddFood.dataset.activeState;
  const food = resolveSelectedFood(logQuickAddFood);
  if (food && !logQuickAddGrams.value) logQuickAddGrams.value = food.unitGrams || 100;
});

logQuickAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  logQuickAddError.textContent = '';
  const food = resolveSelectedFood(logQuickAddFood);
  const grams = Number(logQuickAddGrams.value);
  if (!food) {
    logQuickAddError.textContent = 'Select a food';
    return;
  }
  if (!grams || grams <= 0) {
    logQuickAddError.textContent = 'Enter a valid weight in grams';
    return;
  }
  try {
    // The server's FOOD_DB only recognizes local ids, so a food pulled in
    // from the live universal search is logged as a custom food carrying
    // its own real per-100g baseline instead of a foodId lookup.
    const payload = isExternalFood(food)
      ? { date: state.date, meal: logMealSelect.value, foodId: CUSTOM_FOOD_ID, grams, customFood: { name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat } }
      : { date: state.date, meal: logMealSelect.value, foodId: food.id, grams };
    const res = await authFetch(`${API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add food');
    state.entries.push(data);
    render();
    refreshStreak();
    logQuickAddForm.reset();
    logQuickAddForm.classList.add('hidden');
    showToast(`Added ${data.name}`);
  } catch (err) {
    logQuickAddError.textContent = err.message;
  }
});

// Runs once after a successful login/register/session-restore — everything
// here needs an authenticated user, unlike the food database or the static
// water-cup grid above, which are safe to set up before that.
function initApp() {
  loadDay();
  loadWeights();
  loadProfile();
  refreshStreak();
  loadPlanPreferences();
  // Compiling the historical messages inbox isn't needed for the first paint
  // of the dashboard, so it's pushed to idle time instead of competing with
  // the loads above for the initial render.
  const scheduleIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  scheduleIdle(() => loadMessages());
}

(async function bootstrapAuth() {
  const token = getToken();
  if (!token) { hideSplash(); return; } // auth overlay is the default visible state
  // Paint the cached username immediately so the profile header doesn't show
  // a "—" placeholder while /auth/me is in flight. This is display-only —
  // the token is still what's re-validated against the server below before
  // any real data loads or the app is revealed.
  const cachedUser = getCachedCurrentUser();
  if (cachedUser) state.user = cachedUser;
  try {
    const res = await authFetch(`${API}/auth/me`);
    if (!res.ok) throw new Error('invalid session');
    const data = await res.json();
    state.user = data;
    revealApp();
    initApp();
    if (!data.onboarded) openCoachWizard({ mode: 'onboarding' });
  } catch {
    state.user = null;
    clearToken();
    // The head script pre-hid the auth overlay on the assumption this token
    // was valid — since it wasn't, undo that so the login form shows.
    document.documentElement.classList.remove('has-session');
  }
})();

// ---------- Data loading ----------
async function loadFoods() {
  try {
    const res = await fetch(`${API}/foods`);
    if (!res.ok) throw new Error('Failed to load food database');
    state.foods = await res.json();
    populateFoodSelects();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Foods sharing a `group` (e.g. White Rice, Oats) represent the same food at
// different states — raw vs. cooked — each with its own per-100g baseline.
// FOOD_GROUPS maps group key -> { groupLabel, defaultState, states: {cooked: id, raw: id} }.
let FOOD_GROUPS = {};

function buildFoodGroups() {
  FOOD_GROUPS = {};
  for (const food of state.foods) {
    if (!food.group) continue;
    if (!FOOD_GROUPS[food.group]) {
      FOOD_GROUPS[food.group] = { groupLabel: food.groupLabel || food.name, states: {}, defaultState: null };
    }
    FOOD_GROUPS[food.group].states[food.state] = food.id;
    if (food.isGroupDefault) FOOD_GROUPS[food.group].defaultState = food.state;
  }
  for (const group of Object.values(FOOD_GROUPS)) {
    if (!group.defaultState) group.defaultState = Object.keys(group.states)[0];
  }
}

// Populates every .f-food <select> on the page (meal cards + the Quick Add
// overlay). A grouped food (raw/cooked) appears once, keyed by its group so
// the Raw/Cooked toggle can swap the effective food without changing options.
function populateFoodSelects() {
  buildFoodGroups();
  document.querySelectorAll('.f-food').forEach((select) => {
    const seenGroups = new Set();
    for (const food of state.foods) {
      if (food.group) {
        if (seenGroups.has(food.group)) continue;
        if (food.state !== FOOD_GROUPS[food.group].defaultState) continue;
        seenGroups.add(food.group);
        const option = document.createElement('option');
        option.value = food.group;
        option.textContent = FOOD_GROUPS[food.group].groupLabel;
        select.appendChild(option);
        continue;
      }
      const option = document.createElement('option');
      option.value = food.id;
      option.textContent = food.name;
      select.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_FOOD_ID;
    customOption.textContent = '+ Custom food…';
    select.appendChild(customOption);
  });
}

// Resolves whatever is currently selected in a .f-food <select> to an actual
// FOOD_DB entry — directly by id, or via a raw/cooked group using the
// select's tracked dataset.activeState. Returns null for empty/custom.
function resolveSelectedFood(select) {
  const val = select.value;
  if (!val || val === CUSTOM_FOOD_ID) return null;
  if (externalFoodCache.has(val)) return externalFoodCache.get(val);
  const group = FOOD_GROUPS[val];
  if (group) {
    const activeState = select.dataset.activeState || group.defaultState;
    const effectiveId = group.states[activeState] || group.states[group.defaultState];
    return state.foods.find((f) => f.id === effectiveId) || null;
  }
  return state.foods.find((f) => f.id === val) || null;
}

// True for a food resolved from the live universal search rather than the
// local FOOD_DB — the server only recognizes local food ids, so these must
// be logged through the customFood path instead of by foodId.
function isExternalFood(food) {
  return Boolean(food) && externalFoodCache.has(food.id);
}

function renderStateToggle(toggleEl, group, activeState) {
  toggleEl.querySelectorAll('.state-toggle-btn').forEach((btn) => {
    const available = Boolean(group.states[btn.dataset.state]);
    btn.classList.toggle('hidden', !available);
    btn.classList.toggle('active', available && btn.dataset.state === activeState);
  });
}

// Keyword matrices used by autoEstimateMacros() to guess a plausible macro
// split for custom foods the user names but doesn't have full nutrition data
// for. First matching profile wins; unmatched names fall back to Balanced.
const MACRO_ESTIMATE_PROFILES = [
  { keywords: ['chicken', 'beef', 'steak', 'turkey', 'pork', 'meat', 'fish', 'salmon', 'tuna', 'egg', 'whey', 'protein', 'shaki', 'goat'], protein: 0.5, carbs: 0.2, fat: 0.3 },
  { keywords: ['rice', 'bread', 'oats', 'pasta', 'potato', 'flour', 'sugar', 'banana', 'apple', 'fruit', 'juice', 'yam', 'cassava'], protein: 0.15, carbs: 0.7, fat: 0.15 },
  { keywords: ['oil', 'butter', 'avocado', 'nuts', 'almond', 'peanut', 'cheese', 'mayo', 'dressing', 'lard'], protein: 0.15, carbs: 0.15, fat: 0.7 }
];
const MACRO_ESTIMATE_BALANCED = { protein: 0.3, carbs: 0.4, fat: 0.3 };

function classifyFoodMacroProfile(name) {
  const lower = name.toLowerCase();
  for (const profile of MACRO_ESTIMATE_PROFILES) {
    if (profile.keywords.some((kw) => lower.includes(kw))) return profile;
  }
  return MACRO_ESTIMATE_BALANCED;
}

// Converts a kcal figure into protein/carbs/fat grams via the matched macro
// split (4/4/9 kcal-per-gram), then scales the trio down if it would ever
// exceed the physical mass it's derived from.
function autoEstimateMacros(name, kcal, grams) {
  const kcalNum = Number(kcal);
  const gramsNum = Number(grams);
  if (!name || !kcalNum || kcalNum <= 0 || !gramsNum || gramsNum <= 0) return null;

  const profile = classifyFoodMacroProfile(name);
  let proteinG = (kcalNum * profile.protein) / 4;
  let carbsG = (kcalNum * profile.carbs) / 4;
  let fatG = (kcalNum * profile.fat) / 9;

  const totalG = proteinG + carbsG + fatG;
  if (totalG > gramsNum) {
    const scale = gramsNum / totalG;
    proteinG *= scale;
    carbsG *= scale;
    fatG *= scale;
  }

  return {
    protein: Math.round(proteinG * 10) / 10,
    carbs: Math.round(carbsG * 10) / 10,
    fat: Math.round(fatG * 10) / 10
  };
}

// English-only parser enforcement (frontend half — see toEnglishAsciiLabel
// in server.js for the server-side mirror). Food descriptions must always
// resolve to English/ASCII before they reach the nutrition estimate or a
// diary entry: this strips accents off Latin script ("café" -> "cafe") via
// Unicode decomposition, then drops any character still outside ASCII
// (non-Latin scripts) since there's no real translation service here.
const COMBINING_DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function sanitizeToEnglishAscii(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Automated Smart Nutrition Lookup Engine — asks the server's
// POST /api/estimate-nutrition for a per-100g { kcal, protein, carbs, fat }
// estimate for a typed food name (staple dictionary match, or a generic
// 4/4/9-balanced fallback), plus a parsed/default portion size in `grams`.
// Returns null on any network/parse failure so callers can silently skip
// auto-population rather than surface an error.
async function fetchNutritionEstimate(foodName) {
  try {
    const res = await fetch(`${API}/estimate-nutrition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foodName: sanitizeToEnglishAscii(foodName) })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

function readCustomFood(card) {
  return {
    name: sanitizeToEnglishAscii(card.querySelector('.f-custom-name').value),
    kcal: Number(card.querySelector('.f-custom-kcal').value || 0),
    protein: Number(card.querySelector('.f-custom-protein').value || 0),
    carbs: Number(card.querySelector('.f-custom-carbs').value || 0),
    fat: Number(card.querySelector('.f-custom-fat').value || 0)
  };
}

function updateFoodPreview(card) {
  const foodSelect = card.querySelector('.f-food');
  const gramsInput = card.querySelector('.f-grams');
  const preview = card.querySelector('[data-role="food-preview"]');

  const food =
    foodSelect.value === CUSTOM_FOOD_ID
      ? readCustomFood(card)
      : resolveSelectedFood(foodSelect);
  const grams = Number(gramsInput.value);
  if (!food || !grams || grams <= 0) {
    preview.textContent = '';
    return;
  }
  const factor = grams / 100;
  const kcal = Math.round(food.kcal * factor);
  const protein = Math.round(food.protein * factor * 10) / 10;
  const carbs = Math.round(food.carbs * factor * 10) / 10;
  const fat = Math.round(food.fat * factor * 10) / 10;
  preview.textContent = `≈ ${kcal} kcal · P ${protein}g · C ${carbs}g · F ${fat}g`;
}

let dateStripWeekStart = null; // tracks which weekStart the rendered date strip reflects

async function loadDay() {
  try {
    const res = await authFetch(`${API}/day?date=${state.date}`);
    if (!res.ok) throw new Error('Failed to load day data');
    const data = await res.json();
    state.settings = data.settings;
    state.entries = data.entries;
    if (dateStripWeekStart !== state.settings.weekStart) {
      dateStripWeekStart = state.settings.weekStart;
      buildDateStrip();
    }
    updateTodayHeaderLabel();
    render();
  } catch (err) {
    showToast(err.message, true);
  }
  await loadWater();
  await loadExercise();
  await loadSteps();
  renderCalorieBar();
}

async function loadProfile() {
  try {
    const res = await authFetch(`${API}/auth/me`);
    if (!res.ok) throw new Error('Failed to load profile');
    state.user = await res.json();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Weekly ribbon (Mon–Sun of the current week) ----------
function buildDateStrip() {
  dateStripEl.innerHTML = '';
  const today = new Date(todayStr() + 'T00:00:00');
  // getDay() is 0 (Sun) - 6 (Sat); convert to a first-day-of-week offset so the
  // ribbon always spans a full week starting on the Settings > Start of the
  // Week choice (defaults to Monday, matching the M T W T F S S layout).
  const weekStartsOnSunday = state.settings?.weekStart === 'sunday';
  const weekStartOffset = weekStartsOnSunday ? today.getDay() : (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - weekStartOffset);

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = d.toLocaleDateString('en-CA');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'week-pill';
    btn.dataset.date = dateStr;
    btn.setAttribute('aria-label', d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
    btn.innerHTML = `
      <span class="week-pill-dot" aria-hidden="true"></span>
      <span class="week-pill-letter">${d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
    `;
    btn.addEventListener('click', () => selectDate(dateStr));
    dateStripEl.appendChild(btn);
  }

  refreshDateStripSelection(false);
}

function refreshDateStripSelection(smooth = true) {
  let selectedEl = null;
  dateStripEl.querySelectorAll('.week-pill').forEach((pill) => {
    const isSelected = pill.dataset.date === state.date;
    pill.classList.toggle('selected', isSelected);
    pill.classList.toggle('is-today', pill.dataset.date === todayStr());
    if (isSelected) selectedEl = pill;
  });
  if (selectedEl) {
    selectedEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  }
}

// Clicking a day pill loads that specific day's food logs (and water/weight
// context) from the backend, same as the old prev/next arrows did.
function selectDate(dateStr) {
  if (dateStr === state.date || dateStr > todayStr()) return;
  state.date = dateStr;
  refreshDateStripSelection();
  loadDay();
}

// ---------- Interactive calendar dropdown (Today header) ----------
// calendarViewYear/Month track which month the dropdown grid is currently
// showing, independent of state.date (the selected/active tracking day) —
// browsing to a different month shouldn't change what's loaded until a day
// cell is actually clicked.
let calendarViewYear = null;
let calendarViewMonth = null;

function updateTodayHeaderLabel() {
  if (state.date === todayStr()) {
    todayHeaderLabelEl.textContent = 'Today';
  } else if (state.date === addDaysToDateStr(todayStr(), -1)) {
    todayHeaderLabelEl.textContent = 'Yesterday';
  } else {
    todayHeaderLabelEl.textContent = formatDateLabel(state.date);
  }
}

function openCalendarDropdown() {
  const active = new Date(state.date + 'T00:00:00');
  calendarViewYear = active.getFullYear();
  calendarViewMonth = active.getMonth();
  closeMonthYearPicker();
  renderCalendarDropdown();
  calendarDropdownEl.classList.add('open');
  calendarDropdownEl.setAttribute('aria-hidden', 'false');
  todayHeaderBtn.setAttribute('aria-expanded', 'true');
}

function closeCalendarDropdown() {
  calendarDropdownEl.classList.remove('open');
  calendarDropdownEl.setAttribute('aria-hidden', 'true');
  todayHeaderBtn.setAttribute('aria-expanded', 'false');
  closeMonthYearPicker();
}

function renderCalendarDropdown() {
  const monthLabel = new Date(calendarViewYear, calendarViewMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  calMonthYearLabelEl.textContent = monthLabel;

  calendarGridEl.innerHTML = '';
  const firstOfMonth = new Date(calendarViewYear, calendarViewMonth, 1);
  // getDay() is 0 (Sun) - 6 (Sat); shift so the grid always starts on Monday
  // to match the MON..SUN weekday row.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement('span');
    blank.className = 'calendar-day-cell is-empty';
    calendarGridEl.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(calendarViewYear, calendarViewMonth, day);
    const dateStr = d.toLocaleDateString('en-CA');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-day-cell';
    btn.textContent = String(day);
    btn.dataset.date = dateStr;
    if (dateStr > today) btn.classList.add('is-future');
    if (dateStr === today) btn.classList.add('is-today');
    if (dateStr === state.date) btn.classList.add('selected');
    btn.setAttribute('aria-label', d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
    btn.addEventListener('click', () => {
      selectDate(dateStr);
      closeCalendarDropdown();
    });
    calendarGridEl.appendChild(btn);
  }
}

// ---------- Month/Year scroll-selector picker overlay ----------
// Lets the user jump the calendar dropdown straight to a distant month/year
// via two scrollable wheel-style columns, instead of clicking the prev/next
// arrows one step at a time. Purely a faster way to move calendarViewYear/
// calendarViewMonth — the existing arrow-click logic above is untouched.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const pickerScrollActive = { month: false, year: false };
const pickerScrollTimers = { month: null, year: null };

function renderMonthYearPicker() {
  pickerMonthColEl.innerHTML = '';
  MONTH_NAMES.forEach((name, idx) => {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.setAttribute('role', 'option');
    item.textContent = name;
    if (idx === calendarViewMonth) item.classList.add('is-focused');
    item.addEventListener('click', () => commitMonthYearSelection('month', idx));
    pickerMonthColEl.appendChild(item);
  });

  pickerYearColEl.innerHTML = '';
  const startYear = calendarViewYear - 6;
  const endYear = calendarViewYear + 6;
  for (let year = startYear; year <= endYear; year++) {
    const item = document.createElement('div');
    item.className = 'picker-item';
    item.setAttribute('role', 'option');
    item.textContent = String(year);
    if (year === calendarViewYear) item.classList.add('is-focused');
    item.addEventListener('click', () => commitMonthYearSelection('year', year));
    pickerYearColEl.appendChild(item);
  }

  centerFocusedPickerItem(pickerMonthColEl);
  centerFocusedPickerItem(pickerYearColEl);
}

function centerFocusedPickerItem(col) {
  const focused = col.querySelector('.picker-item.is-focused');
  if (!focused) return;
  col.scrollTop = focused.offsetTop - (col.clientHeight / 2 - focused.offsetHeight / 2);
}

// While scrolling, continuously highlight whichever item sits under the
// center selection bar so the user can see what they'll land on.
function updatePickerFocusFromScroll(col) {
  const items = col.querySelectorAll('.picker-item');
  const centerY = col.scrollTop + col.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  items.forEach((item) => {
    const dist = Math.abs((item.offsetTop + item.offsetHeight / 2) - centerY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = item;
    }
  });
  items.forEach((item) => item.classList.toggle('is-focused', item === closest));
  return closest;
}

function commitMonthYearSelection(kind, value) {
  if (kind === 'month') calendarViewMonth = value;
  else calendarViewYear = value;
  renderCalendarDropdown();
  closeMonthYearPicker();
}

function attachPickerScrollHandling(col, kind) {
  // Only auto-commit on scrolls the user actually drove (wheel/touch), so the
  // initial programmatic centering above never closes the picker on its own.
  col.addEventListener('wheel', () => { pickerScrollActive[kind] = true; }, { passive: true });
  col.addEventListener('touchstart', () => { pickerScrollActive[kind] = true; }, { passive: true });
  col.addEventListener('scroll', () => {
    const focused = updatePickerFocusFromScroll(col);
    if (!pickerScrollActive[kind] || !focused) return;
    clearTimeout(pickerScrollTimers[kind]);
    pickerScrollTimers[kind] = setTimeout(() => {
      const value = kind === 'month'
        ? Array.from(pickerMonthColEl.children).indexOf(focused)
        : Number(focused.textContent);
      commitMonthYearSelection(kind, value);
    }, 180);
  });
}
attachPickerScrollHandling(pickerMonthColEl, 'month');
attachPickerScrollHandling(pickerYearColEl, 'year');

function openMonthYearPicker() {
  monthYearPickerViewEl.classList.add('open');
  monthYearPickerViewEl.setAttribute('aria-hidden', 'false');
  calendarWeekdaysEl.style.display = 'none';
  calendarGridEl.style.display = 'none';
  calendarMonthYearBtn.setAttribute('aria-expanded', 'true');
  // Build/center only after the view is actually visible — centering reads
  // layout metrics (offsetTop/clientHeight) that are meaningless while the
  // container is still display:none.
  renderMonthYearPicker();
}

function closeMonthYearPicker() {
  monthYearPickerViewEl.classList.remove('open');
  monthYearPickerViewEl.setAttribute('aria-hidden', 'true');
  calendarWeekdaysEl.style.display = '';
  calendarGridEl.style.display = '';
  calendarMonthYearBtn.setAttribute('aria-expanded', 'false');
  pickerScrollActive.month = false;
  pickerScrollActive.year = false;
}

calendarMonthYearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (monthYearPickerViewEl.classList.contains('open')) closeMonthYearPicker();
  else openMonthYearPicker();
});

function changeCalendarViewMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth < 0) {
    calendarViewMonth = 11;
    calendarViewYear -= 1;
  } else if (calendarViewMonth > 11) {
    calendarViewMonth = 0;
    calendarViewYear += 1;
  }
  renderCalendarDropdown();
}

todayHeaderBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (calendarDropdownEl.classList.contains('open')) closeCalendarDropdown();
  else openCalendarDropdown();
});
calPrevMonthBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  changeCalendarViewMonth(-1);
});
calNextMonthBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  changeCalendarViewMonth(1);
});
document.addEventListener('click', (e) => {
  if (!calendarDropdownEl.classList.contains('open')) return;
  if (calendarDropdownEl.contains(e.target) || todayHeaderBtn.contains(e.target)) return;
  closeCalendarDropdown();
});

// ---------- Water ----------
function buildWaterCups() {
  waterCupsEl.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cup-btn';
    btn.dataset.index = String(i);
    btn.setAttribute('aria-label', `Cup ${i + 1}`);
    btn.textContent = '💧';
    btn.addEventListener('click', () => {
      const nextFilled = state.water === i + 1 ? i : i + 1;
      setWaterFilled(nextFilled);
    });
    waterCupsEl.appendChild(btn);
  }
}

async function loadWater() {
  try {
    const res = await authFetch(`${API}/water?date=${state.date}`);
    if (!res.ok) throw new Error('Failed to load water log');
    const data = await res.json();
    state.water = data.filled;
    state.waterOz = data.ounces;
    renderWater();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderWater() {
  waterCupsEl.querySelectorAll('.cup-btn').forEach((cup, i) => {
    cup.classList.toggle('filled', i < state.water);
  });
  waterFilledEl.textContent = state.water;
}

async function setWaterFilled(filled) {
  try {
    const res = await authFetch(`${API}/water`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, filled })
    });
    if (!res.ok) throw new Error('Failed to save water log');
    const data = await res.json();
    state.water = data.filled;
    state.waterOz = data.ounces;
    renderWater();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Weight (Progress tab) ----------
async function loadWeights() {
  try {
    const res = await authFetch(`${API}/weights`);
    if (!res.ok) throw new Error('Failed to load weight history');
    state.weights = await res.json();
    renderWeights();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderWeights() {
  weightTimelineEl.innerHTML = '';
  if (state.weights.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No weight logged yet.';
    weightTimelineEl.appendChild(empty);
  } else {
    // state.weights arrives newest-first from GET /api/weights, so this list
    // is already in descending order without a client-side sort.
    for (const w of state.weights) {
      weightTimelineEl.appendChild(buildWeightEntry(w));
    }
  }
  renderWeightChart();
}

// Glowing cyan trend line across every logged weigh-in, reusing the same
// .macro-history-* SVG conventions as the Weight & Measurements chart
// (renderWeightMeasurementsChart) so both charts render identically.
function renderWeightChart() {
  weightChartAxisEl.innerHTML = '';
  weightChartSvgEl.innerHTML = '';

  const chronological = state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  const hasEnoughData = chronological.length >= 2;
  weightChartEmptyEl.classList.toggle('hidden', hasEnoughData);
  weightChartSvgEl.classList.toggle('hidden', !hasEnoughData);
  weightChartAxisEl.classList.toggle('hidden', !hasEnoughData);
  if (!hasEnoughData) return;

  // The point/gridline math + SVG markup write is deferred a frame so it
  // never lands in the middle of a scroll or gesture's own layout work.
  requestAnimationFrame(() => {
    const unit = getWeightUnit();
    const values = chronological.map((w) => (unit === 'lbs' ? kgToLbs(w.weight) : w.weight));
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const ceiling = maxVal === minVal ? maxVal + 1 : maxVal;
    const floor = maxVal === minVal ? Math.max(0, minVal - 1) : minVal;

    weightChartAxisEl.innerHTML = '';
    for (let i = 4; i >= 0; i--) {
      const span = document.createElement('span');
      span.textContent = Math.round(floor + ((ceiling - floor) / 4) * i);
      weightChartAxisEl.appendChild(span);
    }

    const width = 300;
    const height = 140;
    const padY = 6;
    const plotHeight = height - padY * 2;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values
      .map((v, i) => {
        const x = values.length > 1 ? i * stepX : width / 2;
        const y = padY + plotHeight - ((v - floor) / (ceiling - floor)) * plotHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const gridLines = [0, 1, 2, 3, 4]
      .map((i) => {
        const y = (padY + (plotHeight / 4) * i).toFixed(1);
        return `<line class="macro-history-grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}" />`;
      })
      .join('');
    weightChartSvgEl.innerHTML = `${gridLines}<polyline class="macro-history-line cyan" points="${points}" />`;
  });
}

function buildWeightEntry(entry) {
  const li = document.createElement('li');
  li.className = 'weight-entry';
  const unit = getWeightUnit();
  const displayWeight = unit === 'lbs' ? Math.round(kgToLbs(entry.weight) * 10) / 10 : entry.weight;
  li.innerHTML = `
    <span class="weight-date">${formatDateLabel(entry.date)}</span>
    <span class="weight-value">${displayWeight} ${unit}</span>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Delete');
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', () => deleteWeight(entry.id));
  li.appendChild(deleteBtn);
  return li;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Weight is always stored server-side in kg; a lbs entry is converted before
// the request goes out, and results are converted back for display. The date
// picker defaults to the active diary date (see openWeightSubtab) but can be
// backdated — POST /api/weights upserts by date, so logging again for a date
// that already has an entry updates it instead of duplicating.
async function handleWeightSubmit(e) {
  e.preventDefault();
  weightError.textContent = '';
  const entered = Number(weightInput.value);
  if (!entered || entered <= 0) {
    weightError.textContent = 'Enter a valid weight';
    return;
  }
  const date = weightDateInput.value || state.date;
  const weightKg = getWeightUnit() === 'lbs' ? lbsToKg(entered) : entered;
  try {
    const res = await authFetch(`${API}/weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, weight: Math.round(weightKg * 10) / 10 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log weight');
    weightInput.value = '';
    await loadWeights();
    showToast('Weight logged');
  } catch (err) {
    weightError.textContent = err.message;
  }
}

async function deleteWeight(id) {
  try {
    const res = await authFetch(`${API}/weights/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete weight entry');
    state.weights = state.weights.filter((w) => w.id !== id);
    renderWeights();
    showToast('Weight entry removed');
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Add Water screen (bottom utility dock) ----------
function getWaterDisplayUnit() {
  return localStorage.getItem(WATER_DISPLAY_UNIT_KEY) === 'ml' ? 'ml' : 'oz';
}
function ozToDisplayUnit(oz, unit) {
  return unit === 'ml' ? oz * OZ_TO_ML : oz;
}
function displayUnitToOz(value, unit) {
  return unit === 'ml' ? value / OZ_TO_ML : value;
}

// The Today tab's hydration grid is 8 cups at 8oz/cup (the classic "8x8"
// daily rule = 64oz), so that's the fill target this graphic animates toward.
function updateWaterFillBar() {
  const targetOz = 64;
  const pct = Math.max(0, Math.min(100, ((state.waterOz + addWaterPendingOz) / targetOz) * 100));
  addWaterCupFill.style.setProperty('--fill-pct', `${pct}%`);
}

function renderAddWaterAmount() {
  const unit = getWaterDisplayUnit();
  addWaterAmountInput.value = Math.round(ozToDisplayUnit(addWaterPendingOz, unit) * 10) / 10;
  addWaterUnitLabel.textContent = unit;
  addWaterUnitValue.textContent = unit;
  updateWaterFillBar();
}

// Builds a unit-aware row of quick-add buttons into `container` (used by both
// the Add Water screen and the Hydration card). `onAdd` receives the tapped
// amount already converted to ounces — the base unit everything is stored in
// — so callers never have to think about which display unit was active.
function renderWaterQuickAddButtons(container, onAdd) {
  if (!container) return;
  const unit = getWaterDisplayUnit();
  container.innerHTML = WATER_QUICKADD_BY_UNIT[unit]
    .map((amount) => `<button type="button" class="water-quickadd-btn" data-amount="${amount}">+${amount} ${unit}</button>`)
    .join('');
  container.querySelectorAll('.water-quickadd-btn').forEach((btn) => {
    btn.addEventListener('click', () => onAdd(displayUnitToOz(Number(btn.dataset.amount), unit)));
  });
}

function renderWaterCardUnitSwitcher() {
  const unit = getWaterDisplayUnit();
  waterCardUnitSwitcher.querySelectorAll('.water-unit-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unit);
  });
  renderWaterQuickAddButtons(waterCardQuickAdd, (oz) => addWaterOunces(oz));
}

// Persists water totals in ounces regardless of the display unit, so
// switching oz<->ml never re-scales or corrupts the already-logged total.
async function addWaterOunces(oz) {
  if (oz <= 0) return;
  try {
    const res = await authFetch(`${API}/water`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, ounces: Math.round((state.waterOz + oz) * 10) / 10 })
    });
    if (!res.ok) throw new Error('Failed to save water log');
    const data = await res.json();
    state.water = data.filled;
    state.waterOz = data.ounces;
    renderWater();
    const unit = getWaterDisplayUnit();
    showToast(`Added ${Math.round(ozToDisplayUnit(oz, unit) * 10) / 10} ${unit} water`);
  } catch (err) {
    showToast(err.message, true);
  }
}

function setWaterDisplayUnit(unit) {
  localStorage.setItem(WATER_DISPLAY_UNIT_KEY, unit === 'ml' ? 'ml' : 'oz');
  renderAddWaterAmount();
  renderWaterQuickAddButtons(addWaterQuickAddRowEl, (oz) => {
    addWaterPendingOz += oz;
    renderAddWaterAmount();
  });
  renderWaterCardUnitSwitcher();
}

function openAddWaterScreen() {
  addWaterPendingOz = 0;
  renderAddWaterAmount();
  renderWaterQuickAddButtons(addWaterQuickAddRowEl, (oz) => {
    addWaterPendingOz += oz;
    renderAddWaterAmount();
  });
  addWaterScreen.classList.add('open');
}
function closeAddWaterScreen() {
  addWaterScreen.classList.remove('open');
}

addWaterBackBtn.addEventListener('click', closeAddWaterScreen);

addWaterAmountInput.addEventListener('input', () => {
  const unit = getWaterDisplayUnit();
  const typed = Number(addWaterAmountInput.value) || 0;
  addWaterPendingOz = Math.max(0, displayUnitToOz(typed, unit));
  updateWaterFillBar();
});

addWaterChangeUnitBtn.addEventListener('click', () => {
  setWaterDisplayUnit(getWaterDisplayUnit() === 'oz' ? 'ml' : 'oz');
});

waterCardUnitSwitcher.addEventListener('click', (e) => {
  const btn = e.target.closest('.water-unit-btn');
  if (!btn) return;
  setWaterDisplayUnit(btn.dataset.unit);
});

renderWaterCardUnitSwitcher();

addWaterSaveBtn.addEventListener('click', async () => {
  const oz = addWaterPendingOz;
  closeAddWaterScreen();
  await addWaterOunces(oz);
});

// ---------- Add Weight screen + Bottom Wheel Picker Sheet ----------
const WHEEL_ITEM_HEIGHT = 40;
const STONE_VALUES = Array.from({ length: 21 }, (_, i) => i);
const POUND_VALUES = Array.from({ length: 14 }, (_, i) => i);

function buildWheelColumn(el, items, formatFn) {
  el.innerHTML = '';
  el.appendChild(Object.assign(document.createElement('div'), { className: 'wheel-col-pad' }));
  for (const val of items) {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.dataset.value = String(val);
    item.textContent = formatFn(val);
    el.appendChild(item);
  }
  el.appendChild(Object.assign(document.createElement('div'), { className: 'wheel-col-pad' }));
}

function scrollWheelToIndex(el, index) {
  el.scrollTop = Math.max(0, index) * WHEEL_ITEM_HEIGHT;
}
function getWheelSelectedIndex(el) {
  return Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT);
}
function highlightWheelSelection(el) {
  const idx = getWheelSelectedIndex(el);
  el.querySelectorAll('.wheel-item').forEach((item, i) => item.classList.toggle('wheel-item-selected', i === idx));
}
function setupWheelScrollHighlight(el) {
  let scrollTimer = null;
  el.addEventListener('scroll', () => {
    highlightWheelSelection(el);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => highlightWheelSelection(el), 120);
  });
}

buildWheelColumn(wheelColStones, STONE_VALUES, (v) => String(v));
buildWheelColumn(wheelColPounds, POUND_VALUES, (v) => String(v));
buildWheelColumn(wheelColFraction, WHEEL_FRACTIONS, (v) => WHEEL_FRACTION_LABELS[v]);
[wheelColStones, wheelColPounds, wheelColFraction].forEach(setupWheelScrollHighlight);

function setWheelToLbs(totalLbs) {
  const stones = Math.max(0, Math.min(20, Math.floor(totalLbs / 14)));
  const remainder = Math.max(0, totalLbs - stones * 14);
  const pounds = Math.max(0, Math.min(13, Math.floor(remainder)));
  const fracRaw = remainder - Math.floor(remainder);
  const fraction = WHEEL_FRACTIONS.reduce((best, f) => (Math.abs(f - fracRaw) < Math.abs(best - fracRaw) ? f : best), 0);

  scrollWheelToIndex(wheelColStones, STONE_VALUES.indexOf(stones));
  scrollWheelToIndex(wheelColPounds, POUND_VALUES.indexOf(pounds));
  scrollWheelToIndex(wheelColFraction, WHEEL_FRACTIONS.indexOf(fraction));
  [wheelColStones, wheelColPounds, wheelColFraction].forEach(highlightWheelSelection);
}

function readWheelLbs() {
  const stones = STONE_VALUES[Math.max(0, Math.min(STONE_VALUES.length - 1, getWheelSelectedIndex(wheelColStones)))];
  const pounds = POUND_VALUES[Math.max(0, Math.min(POUND_VALUES.length - 1, getWheelSelectedIndex(wheelColPounds)))];
  const fraction = WHEEL_FRACTIONS[Math.max(0, Math.min(WHEEL_FRACTIONS.length - 1, getWheelSelectedIndex(wheelColFraction)))];
  return stones * 14 + pounds + fraction;
}

function formatWeightStLbFraction(totalLbs) {
  const stones = Math.floor(totalLbs / 14);
  const remainder = totalLbs - stones * 14;
  const pounds = Math.floor(remainder);
  const fraction = Math.round((remainder - pounds) * 4) / 4;
  const fracLabel = fraction > 0 ? WHEEL_FRACTION_LABELS[fraction] : '';
  return `${stones} st ${pounds}${fracLabel} lb`;
}

function closeWeightWheelSheet() {
  weightWheelSheet.classList.remove('open');
}
weightWheelCloseBtn.addEventListener('click', closeWeightWheelSheet);
weightWheelBackdrop.addEventListener('click', closeWeightWheelSheet);

addWeightWeightRow.addEventListener('click', () => {
  const currentKg = addWeightPending.weightKg ?? state.weights[0]?.weight ?? 70;
  setWheelToLbs(kgToLbs(currentKg));
  weightWheelSheet.classList.add('open');
});

weightWheelSaveBtn.addEventListener('click', () => {
  const totalLbs = readWheelLbs();
  addWeightPending.weightKg = Math.round(lbsToKg(totalLbs) * 10) / 10;
  addWeightValueDisplay.textContent = formatWeightStLbFraction(totalLbs);
  closeWeightWheelSheet();
});

function formatAddWeightDateDisplay(dateStr) {
  return dateStr === todayStr() ? `Today, ${formatDateUK(dateStr)}` : formatDateUK(dateStr);
}

addWeightDateRow.addEventListener('click', () => {
  addWeightDateInput.value = addWeightPending.date || state.date;
  if (addWeightDateInput.showPicker) addWeightDateInput.showPicker();
  else addWeightDateInput.click();
});

addWeightDateInput.addEventListener('change', () => {
  if (!addWeightDateInput.value) return;
  addWeightPending.date = addWeightDateInput.value;
  addWeightDateDisplay.textContent = formatAddWeightDateDisplay(addWeightPending.date);
});

addWeightPhotoRow.addEventListener('click', () => addWeightPhotoInput.click());

addWeightPhotoInput.addEventListener('change', () => {
  const file = addWeightPhotoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    addWeightPending.photo = reader.result;
    addWeightPhotoPreview.src = reader.result;
    addWeightPhotoPreview.classList.remove('hidden');
    addWeightPhotoValue.textContent = 'Photo added';
  };
  reader.readAsDataURL(file);
});

function openAddWeightScreen() {
  const latestKg = state.weights[0]?.weight ?? null;
  addWeightPending = { weightKg: latestKg, date: state.date, photo: null };
  addWeightValueDisplay.textContent = latestKg ? formatWeightStLbFraction(kgToLbs(latestKg)) : 'Set weight';
  addWeightDateDisplay.textContent = formatAddWeightDateDisplay(state.date);
  addWeightDateInput.max = todayStr();
  addWeightPhotoValue.textContent = 'Add photo';
  addWeightPhotoPreview.classList.add('hidden');
  addWeightPhotoPreview.src = '';
  addWeightScreen.classList.add('open');
}
function closeAddWeightScreen() {
  addWeightScreen.classList.remove('open');
}

addWeightBackBtn.addEventListener('click', closeAddWeightScreen);

addWeightSaveBtn.addEventListener('click', async () => {
  if (!addWeightPending.weightKg) {
    showToast('Set a weight first', true);
    return;
  }
  try {
    const res = await authFetch(`${API}/weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: addWeightPending.date || state.date,
        weight: addWeightPending.weightKg,
        ...(addWeightPending.photo ? { photo: addWeightPending.photo } : {})
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log weight');
    await loadWeights();
    closeAddWeightScreen();
    showToast('Weight logged');
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Add Exercise bottom sheet ----------
async function loadExercise() {
  try {
    const res = await authFetch(`${API}/exercise?date=${state.date}`);
    if (!res.ok) throw new Error('Failed to load exercise log');
    state.exercise = await res.json();
    renderExercise();
    renderCalorieBar();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderExercise() {
  const totalBurned = state.exercise.reduce((sum, e) => sum + e.caloriesBurned, 0);
  exerciseCaloriesBurnedEl.textContent = totalBurned.toLocaleString();
  exerciseEntryListEl.innerHTML = '';
  if (state.exercise.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No exercise logged yet today.';
    exerciseEntryListEl.appendChild(li);
    return;
  }
  for (const entry of state.exercise) {
    const li = document.createElement('li');
    li.className = 'exercise-entry';
    li.innerHTML = `
      <span>
        <span class="exercise-entry-name">${escapeHtml(entry.name)}</span><br>
        <span class="exercise-entry-meta">${entry.minutes} min</span>
      </span>
      <span class="exercise-entry-cals">-${entry.caloriesBurned} kcal</span>
    `;
    exerciseEntryListEl.appendChild(li);
  }
}

// ---------- Exercise Hub (MFP-style Exercise view opened from the home Exercise card) ----------
const exerciseHubView = document.getElementById('exerciseHubView');
const exerciseHubBackBtn = document.getElementById('exerciseHubBackBtn');
const exerciseHubDropdownBtn = document.getElementById('exerciseHubDropdownBtn');
const exerciseHubDropdownMenu = document.getElementById('exerciseHubDropdownMenu');
const exerciseAdjustmentCardEl = document.getElementById('exerciseAdjustmentCard');
const exerciseAdjustmentTitleEl = document.getElementById('exerciseAdjustmentTitle');
const exerciseHubEntryListEl = document.getElementById('exerciseHubEntryList');
const exerciseHubLogMoreBtn = document.getElementById('exerciseHubLogMoreBtn');
const mfpAdjustmentSheet = document.getElementById('mfpAdjustmentSheet');
const mfpAdjustmentEarnedEl = document.getElementById('mfpAdjustmentEarned');
const mfpAdjustmentLearnMoreBtn = document.getElementById('mfpAdjustmentLearnMoreBtn');

// MyFitnessPal's iOS app nudges the calorie goal up on high-step days; this
// mirrors that "calorie adjustment" using today's synced/logged step count.
function getStepAdjustmentCalories() {
  const today = (state.steps || []).find((s) => s.date === todayStr());
  const steps = today ? today.steps : 0;
  return Math.floor(steps * 0.04);
}

function renderExerciseAdjustmentCard() {
  const extra = getStepAdjustmentCalories();
  exerciseAdjustmentTitleEl.textContent = `${extra.toLocaleString()} cal, 1 minutes`;
  mfpAdjustmentEarnedEl.textContent = extra.toLocaleString();
}

function renderExerciseHubEntryList() {
  exerciseHubEntryListEl.innerHTML = '';
  if (!state.exercise || state.exercise.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No exercise logged yet today.';
    exerciseHubEntryListEl.appendChild(li);
    return;
  }
  for (const entry of state.exercise) {
    const li = document.createElement('li');
    li.className = 'exercise-entry';
    li.innerHTML = `
      <span>
        <span class="exercise-entry-name">${escapeHtml(entry.name)}</span><br>
        <span class="exercise-entry-meta">${entry.minutes} min</span>
      </span>
      <span class="exercise-entry-cals">-${entry.caloriesBurned} kcal</span>
    `;
    exerciseHubEntryListEl.appendChild(li);
  }
}

async function openExerciseHubView() {
  await loadSteps();
  renderExerciseAdjustmentCard();
  renderExerciseHubEntryList();
  renderCalorieBar();
  openSubView(exerciseHubView);
}
exerciseHubBackBtn.addEventListener('click', () => closeSubView(exerciseHubView));
document.querySelector('.exercise-card').addEventListener('click', () => openExerciseHubView());

exerciseHubDropdownBtn.addEventListener('click', () => {
  const expanded = exerciseHubDropdownBtn.getAttribute('aria-expanded') === 'true';
  exerciseHubDropdownBtn.setAttribute('aria-expanded', String(!expanded));
  exerciseHubDropdownMenu.classList.toggle('hidden', expanded);
});

exerciseHubDropdownMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-jump]');
  if (!item) return;
  exerciseHubDropdownMenu.classList.add('hidden');
  exerciseHubDropdownBtn.setAttribute('aria-expanded', 'false');
  const jump = item.dataset.jump;
  if (jump === 'exercise') return;
  closeSubView(exerciseHubView);
  requestAnimationFrame(() => {
    let target;
    if (jump === 'water') target = document.querySelector('.water-card');
    else if (jump === 'all') target = document.getElementById('meals');
    else target = document.querySelector(`.meal-card[data-meal="${jump}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

exerciseAdjustmentCardEl.addEventListener('click', () => {
  renderExerciseAdjustmentCard();
  mfpAdjustmentSheet.classList.add('open');
});
mfpAdjustmentSheet.addEventListener('click', (e) => {
  if (e.target === mfpAdjustmentSheet) mfpAdjustmentSheet.classList.remove('open');
});
mfpAdjustmentLearnMoreBtn.addEventListener('click', () => {
  showToast("Steps convert into extra calories you can eat, just like MyFitnessPal's iOS calorie adjustment.");
});

exerciseHubLogMoreBtn.addEventListener('click', () => {
  closeSubView(exerciseHubView);
  openAddExerciseSheet();
});

function populateExerciseNameSelect(type) {
  exerciseNameSelect.innerHTML = '';
  for (const name of EXERCISE_PRESETS[type]) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    exerciseNameSelect.appendChild(opt);
  }
}

function openAddExerciseSheet() {
  activeExerciseType = null;
  exerciseQuickForm.reset();
  exerciseQuickForm.classList.add('hidden');
  exerciseFormError.textContent = '';
  document.querySelectorAll('.exercise-block').forEach((b) => b.classList.remove('active'));
  addExerciseSheet.classList.add('open');
}
function closeAddExerciseSheet() {
  addExerciseSheet.classList.remove('open');
}

document.querySelectorAll('.exercise-block').forEach((block) => {
  block.addEventListener('click', () => {
    const type = block.dataset.exerciseType;
    if (type === 'routines') {
      showToast('Workout Routines are coming soon');
      return;
    }
    const wasActive = activeExerciseType === type;
    document.querySelectorAll('.exercise-block').forEach((b) => b.classList.toggle('active', b === block && !wasActive));
    if (wasActive) {
      activeExerciseType = null;
      exerciseQuickForm.classList.add('hidden');
      return;
    }
    activeExerciseType = type;
    populateExerciseNameSelect(type);
    exerciseFormError.textContent = '';
    exerciseQuickForm.classList.remove('hidden');
  });
});

// Clicking outside the sheet's card bounds dismisses it, same pattern used by
// every other overlay in the app (log-overlay, modal-overlay, etc.).
addExerciseSheet.addEventListener('click', (e) => {
  if (e.target === addExerciseSheet) closeAddExerciseSheet();
});

exerciseQuickForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  exerciseFormError.textContent = '';
  const minutes = Number(exerciseMinutesInput.value);
  const caloriesBurned = Number(exerciseCaloriesInput.value);
  if (!minutes || minutes <= 0) {
    exerciseFormError.textContent = 'Enter valid minutes';
    return;
  }
  if (caloriesBurned < 0 || Number.isNaN(caloriesBurned)) {
    exerciseFormError.textContent = 'Enter calories burned';
    return;
  }
  try {
    const res = await authFetch(`${API}/exercise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, type: activeExerciseType, name: exerciseNameSelect.value, minutes, caloriesBurned })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log exercise');
    state.exercise.unshift(data);
    renderExercise();
    renderCalorieBar();
    closeAddExerciseSheet();
    showToast(`Logged ${data.name}`);
  } catch (err) {
    exerciseFormError.textContent = err.message;
  }
});

// Pull-down-to-dismiss: drag the grabber handle down past a threshold to
// close the sheet, mirroring the native bottom-sheet swipe gesture.
(function setupExerciseSheetSwipe() {
  let startY = null;
  let currentDy = 0;

  function onStart(e) {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    addExerciseSheetPanel.classList.add('dragging');
  }
  function onMove(e) {
    if (startY === null) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    currentDy = Math.max(0, y - startY);
    addExerciseSheetPanel.style.transform = `translateY(${currentDy}px)`;
  }
  function onEnd() {
    if (startY === null) return;
    addExerciseSheetPanel.classList.remove('dragging');
    addExerciseSheetPanel.style.transform = '';
    if (currentDy > 80) closeAddExerciseSheet();
    startY = null;
    currentDy = 0;
  }

  addExerciseGrabber.addEventListener('touchstart', onStart, { passive: true });
  addExerciseGrabber.addEventListener('touchmove', onMove, { passive: true });
  addExerciseGrabber.addEventListener('touchend', onEnd);
  addExerciseGrabber.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
})();

// Re-entering the Progress tab resumes whichever sub-tab was last active,
// mirroring how the other top-level tabs re-run their open*Tab() setup.
function openProgressTab() {
  switchProgressSubtab(currentProgressSubtab);
}

function openWeightSubtab() {
  weightError.textContent = '';
  weightDateInput.value = state.date;
  applyWeightUnitUI();
}

// ---------- History (shared by Overview + Calories toggle) ----------
async function loadHistory(params) {
  try {
    const query = params.days ? `days=${params.days}` : `start=${params.start}&end=${params.end}`;
    const res = await authFetch(`${API}/history?${query}`);
    if (!res.ok) throw new Error('Failed to load history');
    return await res.json();
  } catch (err) {
    showToast(err.message, true);
    return null;
  }
}

function formatChartLabel(dateStr, totalDays) {
  const d = new Date(dateStr + 'T00:00:00');
  return totalDays > 10
    ? d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    : d.toLocaleDateString('en-US', { weekday: 'short' });
}

// Shared by every hand-rolled history chart (Calories, Overview, and the
// per-macro Protein/Carbs/Fat charts) — same column structure, different
// metric key and day counts.
function renderMetricBarChart(container, days, metricKey, goal) {
  container.innerHTML = '';
  const maxScale = Math.max(goal || 0, ...days.map((d) => d[metricKey]), 1);
  for (const day of days) {
    const value = day[metricKey];
    const pct = Math.min((value / maxScale) * 100, 100);
    const over = goal > 0 && value > goal;
    const col = document.createElement('div');
    col.className = 'bar-chart-col';
    col.innerHTML = `
      <span class="bar-chart-value">${Math.round(value)}</span>
      <div class="bar-chart-track"><div class="bar-chart-fill${over ? ' over-goal' : ''}" style="height:${pct}%"></div></div>
      <span class="bar-chart-label">${formatChartLabel(day.date, days.length)}</span>
    `;
    container.appendChild(col);
  }
}

function renderCalorieBarChart(container, days, goal) {
  renderMetricBarChart(container, days, 'calories', goal);
}

// ---------- Overview sub-tab ----------
async function openOverviewSubtab() {
  renderTrackingSummary();
  const history = await loadHistory({ days: 7 });
  if (!history) return;
  state.history = history;
  renderOverviewCalorieChart(history);
  renderOverviewMacroAverages(history);
}

function renderOverviewCalorieChart(history) {
  const goal = state.settings ? state.settings.calorieGoal : 0;
  renderCalorieBarChart(overviewCalorieChartEl, history.days, goal);
}

function renderOverviewMacroAverages(history) {
  const goals = state.settings ? state.settings.macroGoals : { protein: 0, carbs: 0, fat: 0 };
  setAvgMacroMetric('protein', history.averages.protein, goals.protein);
  setAvgMacroMetric('carbs', history.averages.carbs, goals.carbs);
  setAvgMacroMetric('fat', history.averages.fat, goals.fat);
}

function setAvgMacroMetric(key, value, goal) {
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  document.getElementById(`overviewAvg${label}`).textContent = Math.round(value);
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  document.getElementById(`overviewAvg${label}Bar`).style.width = `${pct}%`;
}

// Start = earliest logged weight, Current = most recent. state.weights is
// already sorted desc by date (see loadWeights), so reverse-sort locally
// instead of re-fetching just to read it chronologically.
function renderTrackingSummary() {
  const startEl = document.getElementById('summaryStartWeight');
  const currentEl = document.getElementById('summaryCurrentWeight');
  const deltaEl = document.getElementById('summaryWeightDelta');
  if (!state.weights || state.weights.length === 0) {
    startEl.textContent = '—';
    currentEl.textContent = '—';
    deltaEl.textContent = '—';
    deltaEl.classList.remove('up', 'down');
    return;
  }
  const unit = getWeightUnit();
  const toDisplay = (kg) => (unit === 'lbs' ? Math.round(kgToLbs(kg) * 10) / 10 : Math.round(kg * 10) / 10);
  const chronological = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const start = chronological[0].weight;
  const current = chronological[chronological.length - 1].weight;
  const delta = Math.round((current - start) * 10) / 10;

  startEl.textContent = `${toDisplay(start)} ${unit}`;
  currentEl.textContent = `${toDisplay(current)} ${unit}`;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  deltaEl.textContent = `${sign}${toDisplay(Math.abs(delta))} ${unit}`;
  deltaEl.classList.toggle('up', delta > 0);
  deltaEl.classList.toggle('down', delta < 0);
}

// ---------- Calories / Nutrients / Macros sub-tab ----------
const NUTRIENT_LABELS = {
  fiber: 'Fiber',
  sugar: 'Sugar',
  saturatedFat: 'Saturated Fat',
  polyunsaturatedFat: 'Polyunsaturated Fat',
  monounsaturatedFat: 'Monounsaturated Fat',
  sodium: 'Sodium',
  cholesterol: 'Cholesterol',
  potassium: 'Potassium',
  iron: 'Iron',
  vitaminA: 'Vitamin A',
  vitaminC: 'Vitamin C',
  vitaminD: 'Vitamin D',
  vitaminB12: 'Vitamin B12'
};
const NUTRIENT_UNITS = {
  fiber: 'g', sugar: 'g', saturatedFat: 'g', polyunsaturatedFat: 'g',
  monounsaturatedFat: 'g', sodium: 'mg', cholesterol: 'mg',
  potassium: 'mg', iron: 'mg', vitaminA: 'mcg', vitaminC: 'mg', vitaminD: 'mcg', vitaminB12: 'mcg'
};
const MACRO_RING_CIRCUMFERENCE = 2 * Math.PI * 34;

// Keeps the outer sub-nav pill (Calories/Nutrients/Macros) in sync with
// whichever position the inner toggle is on, so the two levels of
// navigation never show conflicting selections.
function setCalNutMacToggle(mode) {
  calNutMacMode = mode;
  currentProgressSubtab = mode;
  cnmToggle.querySelectorAll('.unit-toggle-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
  cnmPanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.cnmPanel !== mode));
  progressSubnavBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === mode));
}

cnmToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.unit-toggle-btn');
  if (!btn) return;
  setCalNutMacToggle(btn.dataset.mode);
});

// Populates the two range selects with the last 91 days, most recent first,
// defaulting to a 7-day window — run once, not on every subtab visit.
function buildHistoryRangeSelects() {
  const today = todayStr();
  const base = new Date(today + 'T00:00:00');
  historyStartSelect.innerHTML = '';
  historyEndSelect.innerHTML = '';
  for (let i = 0; i <= 90; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const value = d.toLocaleDateString('en-CA');
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const optStart = document.createElement('option');
    optStart.value = value;
    optStart.textContent = label;
    historyStartSelect.appendChild(optStart);
    historyEndSelect.appendChild(optStart.cloneNode(true));
  }
  const sevenDaysAgo = new Date(base);
  sevenDaysAgo.setDate(base.getDate() - 6);
  historyStartSelect.value = sevenDaysAgo.toLocaleDateString('en-CA');
  historyEndSelect.value = today;
  cnmRangeInitialized = true;
}

async function loadCnmHistory() {
  const start = historyStartSelect.value;
  const end = historyEndSelect.value;
  if (!start || !end || start > end) {
    showToast('Start date must be on or before end date', true);
    return;
  }
  const history = await loadHistory({ start, end });
  if (!history) return;
  state.history = history;
  renderCaloriesHistoryChart(history);
  renderNutrientsList(history.averages);
  renderMacroRings(history.averages);
  renderMacroBreakdownChart(history);
}

async function openCalNutMacSubtab() {
  if (!cnmRangeInitialized) buildHistoryRangeSelects();
  await loadCnmHistory();
}

historyStartSelect.addEventListener('change', loadCnmHistory);
historyEndSelect.addEventListener('change', loadCnmHistory);

function renderCaloriesHistoryChart(history) {
  const goal = state.settings ? state.settings.calorieGoal : 0;
  renderCalorieBarChart(caloriesHistoryChartEl, history.days, goal);
  document.getElementById('caloriesHistoryAvg').textContent = Math.round(history.averages.calories);
}

function renderNutrientsList(averages) {
  nutrientListEl.innerHTML = '';
  for (const key of Object.keys(NUTRIENT_LABELS)) {
    const li = document.createElement('li');
    li.className = 'nutrient-row';
    li.innerHTML = `<span class="nutrient-name">${NUTRIENT_LABELS[key]}</span><span class="nutrient-value">${averages[key] ?? 0}${NUTRIENT_UNITS[key]}</span>`;
    nutrientListEl.appendChild(li);
  }
}

// Combined Protein/Carbs/Fat breakdown for the selected range, as one
// interactive Chart.js doughnut chart: each slice is that macro's share of
// cumulative macro-calories across `history.days`, colored with the app's
// neon accents (Carbs=cyan, Fat=violet, Protein=green). Compact gram+percent
// lines render underneath from the same totals.
let macroPieChartInstance = null;

function renderMacroBreakdownChart(history) {
  const days = history.days || [];
  const canvas = document.getElementById('macroPieChart');
  const linesEl = document.getElementById('macroPieCompactLines');
  linesEl.innerHTML = '';

  const totals = days.reduce(
    (acc, d) => {
      acc.protein += d.protein || 0;
      acc.carbs += d.carbs || 0;
      acc.fat += d.fat || 0;
      return acc;
    },
    { protein: 0, carbs: 0, fat: 0 }
  );

  const proteinCals = totals.protein * 4;
  const carbsCals = totals.carbs * 4;
  const fatCals = totals.fat * 9;
  const calTotal = proteinCals + carbsCals + fatCals;
  const pctOf = (cals) => (calTotal > 0 ? Math.round((cals / calTotal) * 100) : 0);

  const style = getComputedStyle(document.documentElement);
  const macros = [
    { key: 'protein', label: 'Protein', grams: totals.protein, pct: pctOf(proteinCals), color: style.getPropertyValue('--neon-green').trim() },
    { key: 'carbs', label: 'Carbs', grams: totals.carbs, pct: pctOf(carbsCals), color: style.getPropertyValue('--neon-cyan').trim() },
    { key: 'fat', label: 'Fat', grams: totals.fat, pct: pctOf(fatCals), color: style.getPropertyValue('--neon-violet').trim() }
  ];

  if (macroPieChartInstance) {
    macroPieChartInstance.destroy();
    macroPieChartInstance = null;
  }

  if (canvas && calTotal > 0) {
    macroPieChartInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: macros.map((m) => m.label),
        datasets: [{
          data: macros.map((m) => m.pct),
          backgroundColor: macros.map((m) => m.color),
          borderColor: 'rgba(0,0,0,0.35)',
          borderWidth: 2,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = macros[ctx.dataIndex];
                return `${m.label}: ${Math.round(m.grams)}g (${m.pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  for (const m of macros) {
    const row = document.createElement('div');
    row.className = 'macro-pie-row';
    row.innerHTML = `
      <span class="macro-pie-dot ${m.key}"></span>
      <span class="macro-pie-name">${m.label}</span>
      <span class="macro-pie-stats"><strong>${Math.round(m.grams)}g</strong> &middot; ${m.pct}%</span>
    `;
    linesEl.appendChild(row);
  }
}

function renderMacroRings(averages) {
  const calsFromProtein = (averages.protein || 0) * 4;
  const calsFromCarbs = (averages.carbs || 0) * 4;
  const calsFromFat = (averages.fat || 0) * 9;
  const total = calsFromProtein + calsFromCarbs + calsFromFat;
  const macros = [
    { key: 'protein', label: 'Protein', cals: calsFromProtein },
    { key: 'carbs', label: 'Carbs', cals: calsFromCarbs },
    { key: 'fat', label: 'Fat', cals: calsFromFat }
  ];
  macroRingsEl.innerHTML = '';
  for (const m of macros) {
    const pct = total > 0 ? Math.round((m.cals / total) * 100) : 0;
    const offset = MACRO_RING_CIRCUMFERENCE * (1 - pct / 100);
    const item = document.createElement('div');
    item.className = 'macro-ring-item';
    item.innerHTML = `
      <div class="macro-ring-wrap">
        <svg viewBox="0 0 80 80" class="macro-ring-svg">
          <circle cx="40" cy="40" r="34" class="ring-track" stroke-width="8" />
          <circle cx="40" cy="40" r="34" class="ring-progress macro-ring-${m.key}" stroke-width="8"
            stroke-dasharray="${MACRO_RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="macro-ring-pct">${pct}%</span>
      </div>
      <span class="macro-ring-label">${m.label}</span>
    `;
    macroRingsEl.appendChild(item);
  }
}

// ---------- Steps sub-tab ----------
function groupByMonth(list, dateField, valueField) {
  const map = new Map();
  for (const item of list) {
    const month = item[dateField].slice(0, 7); // YYYY-MM
    map.set(month, (map.get(month) || 0) + (item[valueField] || 0));
  }
  return map;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Rounds up to a "nice" axis ceiling (next 1/2/5/10 x a power of ten) so the
// 5 evenly-spaced axis labels line up cleanly with the tallest bar.
function niceCeil(value) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function formatStepsValue(value) {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

async function loadSteps(force = false) {
  if (stepsLoaded && !force) return;
  try {
    const res = await authFetch(`${API}/steps`);
    if (!res.ok) throw new Error('Failed to load steps history');
    state.steps = await res.json();
    stepsLoaded = true;
    renderStepsAnalytics();
    renderStepsMonthlyChart();
    renderStepsTimeline();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openStepsSubtab() {
  stepsError.textContent = '';
  loadSteps();
}

function renderStepsAnalytics() {
  const list = state.steps;
  const avgEl = document.getElementById('stepsAvg');
  const bestEl = document.getElementById('stepsBestMonth');
  const totalEl = document.getElementById('stepsTotal');
  if (list.length === 0) {
    avgEl.textContent = '0';
    bestEl.textContent = '—';
    totalEl.textContent = '0';
    return;
  }
  const total = list.reduce((sum, s) => sum + s.steps, 0);
  const avg = Math.round(total / list.length);
  const monthly = groupByMonth(list, 'date', 'steps');
  let bestMonth = null;
  let bestTotal = -1;
  for (const [month, sum] of monthly) {
    if (sum > bestTotal) {
      bestTotal = sum;
      bestMonth = month;
    }
  }
  avgEl.textContent = avg.toLocaleString();
  totalEl.textContent = total.toLocaleString();
  bestEl.textContent = bestMonth ? monthLabel(bestMonth) : '—';
}

function renderStepsMonthlyChart() {
  const monthly = groupByMonth(state.steps, 'date', 'steps');
  const months = [...monthly.keys()].sort().slice(-6);

  stepsChartAxisEl.innerHTML = '';
  stepsMonthlyChartEl.innerHTML = '';

  if (months.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No steps logged yet.';
    stepsMonthlyChartEl.appendChild(empty);
    return;
  }

  const maxVal = Math.max(...months.map((m) => monthly.get(m)));
  const ceiling = niceCeil(maxVal);
  for (let i = 4; i >= 0; i--) {
    const span = document.createElement('span');
    span.textContent = formatStepsValue(Math.round((ceiling / 4) * i));
    stepsChartAxisEl.appendChild(span);
  }

  for (const month of months) {
    const val = monthly.get(month);
    const pct = Math.min((val / ceiling) * 100, 100);
    const col = document.createElement('div');
    col.className = 'bar-chart-col';
    col.innerHTML = `
      <span class="bar-chart-value">${formatStepsValue(val)}</span>
      <div class="bar-chart-track"><div class="bar-chart-fill" style="height:${pct}%"></div></div>
      <span class="bar-chart-label">${monthLabel(month).split(' ')[0]}</span>
    `;
    stepsMonthlyChartEl.appendChild(col);
  }
}

function renderStepsTimeline() {
  stepsTimelineEl.innerHTML = '';
  if (state.steps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No steps logged yet.';
    stepsTimelineEl.appendChild(empty);
    return;
  }
  for (const s of state.steps) {
    stepsTimelineEl.appendChild(buildStepsEntry(s));
  }
}

function buildStepsEntry(entry) {
  const li = document.createElement('li');
  li.className = 'weight-entry';
  li.innerHTML = `
    <span class="weight-date">${formatDateLabel(entry.date)}</span>
    <span class="weight-value">${entry.steps.toLocaleString()} steps</span>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Delete');
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', () => deleteStepsEntry(entry.id));
  li.appendChild(deleteBtn);
  return li;
}

async function handleStepsSubmit(e) {
  e.preventDefault();
  stepsError.textContent = '';
  const entered = Number(stepsInput.value);
  if (!Number.isInteger(entered) || entered < 0) {
    stepsError.textContent = 'Enter a valid step count';
    return;
  }
  try {
    const res = await authFetch(`${API}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, steps: entered })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log steps');
    stepsInput.value = '';
    await loadSteps(true);
    showToast('Steps logged');
  } catch (err) {
    stepsError.textContent = err.message;
  }
}

async function deleteStepsEntry(id) {
  try {
    const res = await authFetch(`${API}/steps/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete steps entry');
    state.steps = state.steps.filter((s) => s.id !== id);
    renderStepsAnalytics();
    renderStepsMonthlyChart();
    renderStepsTimeline();
    showToast('Steps entry removed');
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Sleep sub-tab ----------
// Sleep's date header shares the app-wide state.date (same as the Today
// tab's date strip and the Weight/Steps loggers) rather than tracking its
// own separate cursor, so the stepper here and the date strip stay in sync.
function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

function renderSleepHeader() {
  const d = new Date(state.date + 'T00:00:00');
  const isToday = state.date === todayStr();
  document.getElementById('sleepHeaderDay').textContent = isToday ? 'Tonight' : d.toLocaleDateString('en-US', { weekday: 'long' });
  document.getElementById('sleepHeaderDate').textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('sleepDateInput').value = state.date;
  document.getElementById('sleepNextDayBtn').disabled = isToday;
}

// Steps/jumps the shared app date, then refreshes both the Sleep view and
// everything else keyed off state.date (Today tab, weight/steps loggers).
function changeSleepDate(dateStr) {
  if (!dateStr || dateStr === state.date || dateStr > todayStr()) return;
  state.date = dateStr;
  refreshDateStripSelection();
  loadDay();
  renderSleepHeader();
  renderSleepDurationRing();
}

function stepSleepDate(delta) {
  changeSleepDate(addDaysToDateStr(state.date, delta));
}

document.getElementById('sleepPrevDayBtn').addEventListener('click', () => stepSleepDate(-1));
document.getElementById('sleepNextDayBtn').addEventListener('click', () => stepSleepDate(1));

const sleepDateInputEl = document.getElementById('sleepDateInput');
sleepDateInputEl.max = todayStr();
document.getElementById('sleepDateBtn').addEventListener('click', () => {
  if (typeof sleepDateInputEl.showPicker === 'function') sleepDateInputEl.showPicker();
  else sleepDateInputEl.focus();
});
sleepDateInputEl.addEventListener('change', () => changeSleepDate(sleepDateInputEl.value));

function openSleepSubtab() {
  sleepError.textContent = '';
  renderSleepHeader();
  renderSleepDurationRing();
  loadSleep();
}

async function loadSleep(force = false) {
  if (sleepLoaded && !force) return;
  try {
    const res = await authFetch(`${API}/sleep`);
    if (!res.ok) throw new Error('Failed to load sleep history');
    state.sleep = await res.json();
    sleepLoaded = true;
    renderSleepDurationRing();
    renderSleepTimeline();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Shows the exact entry for the selected date (state.date, steppable via the
// prev/next/calendar controls in the header). Only falls back to the most
// recently logged night — state.sleep is sorted desc by date — when the
// selected date is today and has nothing logged yet, so the ring isn't just
// blank on first use; browsing back to a specific past date with no entry
// correctly shows empty rather than silently borrowing another night's data.
function renderSleepDurationRing() {
  const entry = state.sleep.find((s) => s.date === state.date) || (state.date === todayStr() ? state.sleep[0] : null);
  const ring = document.getElementById('sleepRing');
  const hoursEl = document.getElementById('sleepHoursValue');
  const total = entry ? entry.totalHours : 0;
  const pct = Math.min(total / 12, 1);
  const offset = RING_CIRCUMFERENCE * (1 - pct);
  ring.style.strokeDasharray = RING_CIRCUMFERENCE;
  ring.style.strokeDashoffset = offset;
  hoursEl.textContent = total;

  document.getElementById('sleepAwakeValue').textContent = `${entry ? entry.awakeHours : 0}h`;
  document.getElementById('sleepRemValue').textContent = `${entry ? entry.remHours : 0}h`;
  document.getElementById('sleepCoreValue').textContent = `${entry ? entry.coreHours : 0}h`;
  document.getElementById('sleepDeepValue').textContent = `${entry ? entry.deepHours : 0}h`;
}

function renderSleepTimeline() {
  sleepTimelineEl.innerHTML = '';
  if (state.sleep.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No sleep logged yet.';
    sleepTimelineEl.appendChild(empty);
    return;
  }
  for (const s of state.sleep) {
    sleepTimelineEl.appendChild(buildSleepEntry(s));
  }
}

function buildSleepEntry(entry) {
  const li = document.createElement('li');
  li.className = 'weight-entry';
  const timesLabel = entry.bedTime && entry.wakeTime ? ` · ${entry.bedTime}→${entry.wakeTime}` : '';
  const qualityLabel = entry.quality ? ` · ${'★'.repeat(entry.quality)}${'☆'.repeat(5 - entry.quality)}` : '';
  li.innerHTML = `
    <span class="weight-date">${formatDateLabel(entry.date)}</span>
    <span class="weight-value">${entry.totalHours}h asleep${timesLabel}${qualityLabel}</span>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Delete');
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', () => deleteSleepEntry(entry.id));
  li.appendChild(deleteBtn);
  return li;
}

async function handleSleepSubmit(e) {
  e.preventDefault();
  sleepError.textContent = '';
  const awakeHours = Number(sleepAwakeInput.value || 0);
  const remHours = Number(sleepRemInput.value || 0);
  const coreHours = Number(sleepCoreInput.value || 0);
  const deepHours = Number(sleepDeepInput.value || 0);
  const bedTime = sleepBedTimeInput.value || '';
  const wakeTime = sleepWakeTimeInput.value || '';
  if ([awakeHours, remHours, coreHours, deepHours].some((v) => Number.isNaN(v) || v < 0)) {
    sleepError.textContent = 'Enter valid, non-negative hours for each phase';
    return;
  }
  if (awakeHours + remHours + coreHours + deepHours > 24) {
    sleepError.textContent = 'Sleep phase hours cannot exceed 24 total';
    return;
  }
  if (!bedTime && !wakeTime && awakeHours + remHours + coreHours + deepHours === 0) {
    sleepError.textContent = 'Enter bed/wake times or a phase breakdown';
    return;
  }
  try {
    const res = await authFetch(`${API}/sleep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        awakeHours,
        remHours,
        coreHours,
        deepHours,
        bedTime: bedTime || undefined,
        wakeTime: wakeTime || undefined,
        quality: selectedSleepQuality || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log sleep');
    sleepAwakeInput.value = '';
    sleepRemInput.value = '';
    sleepCoreInput.value = '';
    sleepDeepInput.value = '';
    sleepBedTimeInput.value = '';
    sleepWakeTimeInput.value = '';
    selectedSleepQuality = 0;
    renderSleepQualityStars();
    await loadSleep(true);
    showToast('Sleep logged');
  } catch (err) {
    sleepError.textContent = err.message;
  }
}

async function deleteSleepEntry(id) {
  try {
    const res = await authFetch(`${API}/sleep/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete sleep entry');
    state.sleep = state.sleep.filter((s) => s.id !== id);
    renderSleepDurationRing();
    renderSleepTimeline();
    showToast('Sleep entry removed');
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Rendering (Today tab) ----------
function render() {
  renderDayTypeSelector();
  renderCalorieBar();
  renderMacros();
  renderMeals();
  refreshLogOverlayLists();
}

// Rest/Work/Gym day-type target lookup — falls back to the base
// calorieGoal/macroGoals plan when no day type is active, so every other
// screen (Overview charts, Macro Goals editor, onboarding) keeps reading
// state.settings.calorieGoal/macroGoals untouched.
function getActiveDayTypeTarget() {
  const s = state.settings || {};
  const active = s.activeDayType;
  return (active && s.dayTypeTargets && s.dayTypeTargets[active]) || null;
}

function renderDayTypeSelector() {
  const active = state.settings?.activeDayType;
  const dayTypeTargets = state.settings?.dayTypeTargets || {};
  dayTypeSelectorEl.querySelectorAll('.day-type-btn').forEach((btn) => {
    const dayType = btn.dataset.dayType;
    btn.classList.toggle('active', dayType === active);
    btn.textContent = dayTypeTargets[dayType]?.label || DAY_TYPE_DEFAULT_LABELS[dayType];
  });
}

function renderCalorieBar() {
  const totals = computeTotals(state.entries);
  const dayTarget = getActiveDayTypeTarget();
  const goal = dayTarget ? dayTarget.calories : state.settings.calorieGoal;
  const consumed = Math.round(totals.calories);
  const burned = (state.exercise || []).reduce((sum, e) => sum + e.caloriesBurned, 0) + getStepAdjustmentCalories();
  const remaining = goal - consumed + burned;

  document.getElementById('caloriesConsumed').textContent = consumed.toLocaleString();
  document.getElementById('calorieGoalLabel').textContent = goal.toLocaleString();

  const remainingEl = document.getElementById('calorieRemaining');
  if (remaining < 0) {
    remainingEl.textContent = `${Math.abs(remaining).toLocaleString()} over`;
    remainingEl.classList.add('over');
  } else {
    remainingEl.textContent = `${remaining.toLocaleString()} left`;
    remainingEl.classList.remove('over');
  }

  const fill = document.getElementById('calorieLinearFill');
  const pct = goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;
  fill.style.width = `${pct}%`;
  fill.style.background = consumed > goal ? 'var(--danger)' : 'var(--neon-cyan)';

  updateHeaderStreak();
}

function renderMacros() {
  const totals = computeTotals(state.entries);
  const dayTarget = getActiveDayTypeTarget();
  const { protein, carbs, fat } = dayTarget || state.settings.macroGoals;
  renderMacroPercentageCard(totals);
  setMacroGoalPanel('protein', totals.protein, protein);
  setMacroGoalPanel('carbs', totals.carbs, carbs);
  setMacroGoalPanel('fat', totals.fat, fat);
}

// Today card 2: each macro's share of today's logged calories (carbs/protein
// at 4 kcal/g, fat at 9 kcal/g) — three bold values plus a matching segmented
// bar. The swap icon flips the displayed unit; the bar itself always tracks
// the calorie share so its proportions stay meaningful either way.
function renderMacroPercentageCard(totals) {
  const carbsCals = totals.carbs * 4;
  const proteinCals = totals.protein * 4;
  const fatCals = totals.fat * 9;
  const macroCalTotal = carbsCals + proteinCals + fatCals;
  const pctOf = (cals) => (macroCalTotal > 0 ? Math.round((cals / macroCalTotal) * 100) : 0);

  const columns = {
    carbs: { pct: pctOf(carbsCals), grams: Math.round(totals.carbs) },
    fat: { pct: pctOf(fatCals), grams: Math.round(totals.fat) },
    protein: { pct: pctOf(proteinCals), grams: Math.round(totals.protein) },
  };

  for (const key of Object.keys(columns)) {
    const { pct, grams } = columns[key];
    document.getElementById(`${key}ValueDisplay`).textContent = macroCardMode === 'grams' ? `${grams}g` : `${pct}%`;
    document.getElementById(`${key}Bar`).style.width = `${pct}%`;
  }
  renderTodayMacroPie(columns);
}

// Today tab: interactive SVG donut/pie mapping Carbs/Protein/Fat % of
// today's logged foods — three stacked circles sharing one circumference,
// each offset to start where the previous slice ended (12 o'clock, via the
// -90deg rotate on .macro-pie-svg). Tapping a slice dims the others and
// shows that macro's grams+percent in the center instead of "Today".
const MACRO_PIE_CIRCUMFERENCE = 2 * Math.PI * 40;
const MACRO_PIE_ORDER = ['carbs', 'fat', 'protein'];
let todayMacroPieColumns = null;
let activeMacroPieSlice = null;

function renderTodayMacroPie(columns) {
  todayMacroPieColumns = columns;
  let cumulative = 0;
  for (const key of MACRO_PIE_ORDER) {
    const pct = columns[key].pct;
    const segLen = (pct / 100) * MACRO_PIE_CIRCUMFERENCE;
    const el = document.getElementById(`todayPie${key.charAt(0).toUpperCase()}${key.slice(1)}`);
    el.style.strokeDasharray = `${segLen} ${MACRO_PIE_CIRCUMFERENCE - segLen}`;
    el.style.strokeDashoffset = String(-cumulative);
    cumulative += segLen;
  }
  if (activeMacroPieSlice) showMacroPieSlice(activeMacroPieSlice);
}

function showMacroPieSlice(key) {
  if (!todayMacroPieColumns) return;
  activeMacroPieSlice = key;
  const wrap = document.getElementById('todayMacroPieWrap');
  wrap.classList.add('dimmed');
  wrap.querySelectorAll('.macro-pie-arc').forEach((arc) => arc.classList.toggle('active', arc.dataset.macro === key));
  const { pct, grams } = todayMacroPieColumns[key];
  document.getElementById('todayMacroPieCenterValue').textContent = `${key.charAt(0).toUpperCase()}${key.slice(1)} ${pct}% ${grams}g`;
}

function resetMacroPieSlice() {
  activeMacroPieSlice = null;
  const wrap = document.getElementById('todayMacroPieWrap');
  wrap.classList.remove('dimmed');
  document.getElementById('todayMacroPieCenterValue').textContent = 'Today';
}

document.getElementById('todayMacroPieWrap').addEventListener('click', (e) => {
  const arc = e.target.closest('.macro-pie-arc');
  const key = arc ? arc.dataset.macro : null;
  if (!key || key === activeMacroPieSlice) resetMacroPieSlice();
  else showMacroPieSlice(key);
});

// Progress > Macros panel keeps its original grams-vs-goal framing, separate
// from the homepage card's calorie-share percentages.
function setMacroGoalPanel(key, value, goal) {
  const rounded = Math.round(value * 10) / 10;
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;

  const label = key.charAt(0).toUpperCase() + key.slice(1);
  document.getElementById(`macrosPanel${label}Value`).textContent = rounded;
  document.getElementById(`macrosPanel${label}Goal`).textContent = goal;
  document.getElementById(`macrosPanel${label}Bar`).style.width = `${pct}%`;
}

// The header badge's currentStreak is computed and persisted server-side
// (Case A/B/C dynamic streak engine — see applyStreakUpdate() in server.js),
// so refreshing it is just a cheap GET, called on load and after every food
// log rather than re-derived client-side.
async function refreshStreak() {
  try {
    const res = await authFetch(`${API}/streak`);
    if (!res.ok) return;
    const data = await res.json();
    state.streak = data.currentStreak;
    updateHeaderStreak();
  } catch {
    // Non-critical — badge just keeps its last known value.
  }
}

function updateHeaderStreak() {
  headerStreakValueEl.textContent = String(state.streak || 0);
}

function openStreakPopover() {
  streakPopoverEl.classList.add('open');
  streakPopoverEl.setAttribute('aria-hidden', 'false');
  headerStreakChipEl.setAttribute('aria-expanded', 'true');
}

function closeStreakPopover() {
  streakPopoverEl.classList.remove('open');
  streakPopoverEl.setAttribute('aria-hidden', 'true');
  headerStreakChipEl.setAttribute('aria-expanded', 'false');
}

headerStreakChipEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (streakPopoverEl.classList.contains('open')) closeStreakPopover();
  else openStreakPopover();
});
streakPopoverCloseBtn.addEventListener('click', closeStreakPopover);
streakPopoverLogBtn.addEventListener('click', () => {
  closeStreakPopover();
  openLogOverlay();
});
document.addEventListener('click', (e) => {
  if (!streakPopoverEl.classList.contains('open')) return;
  if (streakPopoverEl.contains(e.target) || headerStreakChipEl.contains(e.target)) return;
  closeStreakPopover();
});

function renderMeals() {
  openSwipeRow = null;
  mealCards.forEach((card) => {
    const mealKey = card.dataset.meal;
    const items = state.entries.filter((e) => e.meal === mealKey);
    const mealKcal = items.reduce((sum, e) => sum + e.calories, 0);

    card.querySelector('[data-role="meal-kcal"]').textContent = `${Math.round(mealKcal)} kcal`;

    const list = card.querySelector('[data-role="food-list"]');
    list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Nothing logged yet.';
      list.appendChild(empty);
    } else {
      for (const item of items) {
        list.appendChild(buildFoodItem(item));
      }
    }
  });
}

// Diary Settings > "Show Decimal Macronutrients" — off (default) rounds to
// whole grams for a cleaner diary list; on shows the server's 1-decimal precision.
function formatMacroGrams(value) {
  return state.settings?.diary?.showDecimalMacros ? value : Math.round(value);
}

function buildFoodItem(item) {
  const wrapper = document.createElement('li');
  wrapper.className = 'food-item-swipe';
  // .food-info is a column flexbox, so this sibling span (rather than being
  // nested inside .food-name) naturally lands on its own line directly
  // beneath the food name instead of trailing it inline.
  const gramsLine = item.grams ? `<span class="food-grams">${item.grams}g</span>` : '';
  wrapper.innerHTML = `
    <div class="food-item-delete-bg">
      <button type="button" class="food-item-delete-trigger" aria-label="Delete ${escapeHtml(item.name)}">🗑</button>
    </div>
    <div class="food-item">
      <div class="food-info">
        <span class="food-name">${escapeHtml(item.name)}</span>
        ${gramsLine}
        <span class="food-macros"><span class="m-protein">P ${formatMacroGrams(item.protein)}g</span> · <span class="m-carbs">C ${formatMacroGrams(item.carbs)}g</span> · <span class="m-fat">F ${formatMacroGrams(item.fat)}g</span></span>
      </div>
      <div class="food-right">
        <span class="food-kcal">${item.calories} kcal</span>
      </div>
    </div>
  `;
  attachSwipeToDelete(wrapper, () => deleteEntry(item.id));
  return wrapper;
}

// ---------- Swipe-to-delete (diary food rows) ----------
// Only one row is ever open at a time; opening a new one or tapping outside
// the currently-open row closes it.
const SWIPE_DELETE_THRESHOLD = 80;
const SWIPE_DELETE_OPEN_X = 76;
let openSwipeRow = null;

function closeSwipeRow(row) {
  row.classList.remove('food-item-swipe--open');
  row.querySelector('.food-item').style.transform = '';
  if (openSwipeRow === row) openSwipeRow = null;
}

document.addEventListener('touchstart', (e) => {
  if (openSwipeRow && !openSwipeRow.contains(e.target)) closeSwipeRow(openSwipeRow);
}, { passive: true });
document.addEventListener('click', (e) => {
  if (openSwipeRow && !openSwipeRow.contains(e.target)) closeSwipeRow(openSwipeRow);
});

function attachSwipeToDelete(wrapper, onDelete) {
  const content = wrapper.querySelector('.food-item');
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = null; // null = undecided, true = horizontal drag, false = vertical scroll

  wrapper.addEventListener('touchstart', (e) => {
    if (openSwipeRow && openSwipeRow !== wrapper) closeSwipeRow(openSwipeRow);
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dx = wrapper.classList.contains('food-item-swipe--open') ? -SWIPE_DELETE_OPEN_X : 0;
    dragging = null;
    wrapper.classList.add('food-item-swipe--dragging');
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const rawDx = t.clientX - startX;
    const rawDy = t.clientY - startY;
    if (dragging === null) {
      if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
      dragging = Math.abs(rawDx) > Math.abs(rawDy);
    }
    if (!dragging) return;
    const base = wrapper.classList.contains('food-item-swipe--open') ? -SWIPE_DELETE_OPEN_X : 0;
    dx = Math.min(0, Math.max(-SWIPE_DELETE_OPEN_X - 12, base + rawDx));
    content.style.transform = `translate3d(${dx}px, 0, 0)`;
  }, { passive: true });

  wrapper.addEventListener('touchend', () => {
    wrapper.classList.remove('food-item-swipe--dragging');
    if (!dragging) return;
    if (dx <= -SWIPE_DELETE_THRESHOLD) {
      wrapper.classList.add('food-item-swipe--open');
      content.style.transform = `translate3d(${-SWIPE_DELETE_OPEN_X}px, 0, 0)`;
      openSwipeRow = wrapper;
    } else {
      closeSwipeRow(wrapper);
    }
    dragging = null;
  });

  wrapper.querySelector('.food-item-delete-trigger').addEventListener('click', () => {
    wrapper.style.maxHeight = `${wrapper.scrollHeight}px`;
    requestAnimationFrame(() => {
      wrapper.classList.add('food-item-swipe--collapsing');
      wrapper.style.maxHeight = '0px';
    });
    wrapper.addEventListener('transitionend', () => onDelete(), { once: true });
  });
}

function computeTotals(entries) {
  return entries.reduce(
    (t, e) => {
      t.calories += e.calories;
      t.protein += e.protein;
      t.carbs += e.carbs;
      t.fat += e.fat;
      return t;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

// ---------- Actions ----------
async function deleteEntry(id) {
  try {
    const res = await authFetch(`${API}/entries/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete entry');
    state.entries = state.entries.filter((e) => e.id !== id);
    render();
    showToast('Food removed');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleInlineAddSubmit(e, card) {
  e.preventDefault();
  const mealKey = card.dataset.meal;
  const errorEl = card.querySelector('[data-role="form-error"]');
  errorEl.textContent = '';

  const foodSelect = card.querySelector('.f-food');
  const gramsInput = card.querySelector('.f-grams');
  const isCustom = foodSelect.value === CUSTOM_FOOD_ID;

  if (isCustom && !card.querySelector('.f-custom-name').value.trim()) {
    errorEl.textContent = 'Enter a name for the custom food';
    return;
  }

  const resolvedFood = isCustom ? null : resolveSelectedFood(foodSelect);
  if (!isCustom && !resolvedFood) {
    errorEl.textContent = 'Select a food';
    return;
  }

  const payload = {
    date: state.date,
    meal: mealKey,
    foodId: isCustom ? CUSTOM_FOOD_ID : resolvedFood.id,
    grams: Number(gramsInput.value || 0)
  };
  if (isCustom) {
    payload.customFood = readCustomFood(card);
  }

  try {
    const res = await authFetch(`${API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add food');
    state.entries.push(data);
    render();
    refreshStreak();
    card.querySelector('.inline-add-form').reset();
    card.querySelector('[data-role="custom-food-fields"]').classList.add('hidden');
    card.querySelector('[data-role="food-preview"]').textContent = '';
    card.querySelector('[data-role="state-toggle"]').classList.add('hidden');
    delete foodSelect.dataset.activeState;
    foodSelect.focus();
    showToast(`Added ${data.name}`);
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ---------- AI Vision Scan ----------
function handleScanFileSelected(input, meal) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => startScan(reader.result, file.name, meal);
  reader.readAsDataURL(file);
  input.value = '';
}

async function startScan(dataUrl, filename, meal) {
  scanContext = null;
  scanImagePreview.src = dataUrl;
  scanDetectedName.textContent = 'Analyzing plate…';
  scanConfidence.textContent = '';
  scanError.textContent = '';
  scanGramsInput.value = '';
  confirmScanBtn.disabled = true;
  scanOverlay.classList.add('open');

  try {
    const res = await authFetch(`${API}/vision/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, filename })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    scanContext = { meal, foodId: data.foodId };
    scanDetectedName.textContent = `Detected: ${data.name}`;
    scanConfidence.textContent = `Confidence: ${data.confidence}% · Estimated Weight: ${data.grams}g`;
    scanGramsInput.value = data.grams;
    confirmScanBtn.disabled = false;
  } catch (err) {
    scanDetectedName.textContent = 'Detection failed';
    scanError.textContent = err.message;
  }
}

async function handleConfirmScan() {
  if (!scanContext) return;
  scanError.textContent = '';
  const grams = Number(scanGramsInput.value);
  if (!grams || grams <= 0) {
    scanError.textContent = 'Enter a valid weight in grams';
    return;
  }

  try {
    const res = await authFetch(`${API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, meal: scanContext.meal, foodId: scanContext.foodId, grams })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log scanned food');
    state.entries.push(data);
    render();
    refreshStreak();
    showToast(`Logged ${data.name} from scan`);
    closeScanModal();
  } catch (err) {
    scanError.textContent = err.message;
  }
}

function closeScanModal() {
  scanOverlay.classList.remove('open');
  scanContext = null;
  scanImagePreview.src = '';
}

// ---------- AI Coach Onboarding Wizard ----------
// Extracted from the old Plan tab: a first-launch overlay that collects
// Height/Weight/Age/Activity/Goal, calls the backend AI formulation
// (POST /api/coach/plan) to establish starting calorie/macro goals, then
// animates away into the dashboard. Also reused (mode: 'manage') by the
// Progress > Overview "Manage Goals" button to recalculate goals later.
function mostRecentWeightKg() {
  if (!state.weights || state.weights.length === 0) return null;
  return [...state.weights].sort((a, b) => b.date.localeCompare(a.date))[0].weight;
}

let onboardingMode = 'onboarding';

function setOnboardingStep(step) {
  onboardingSteps.forEach((el) => el.classList.toggle('hidden', Number(el.dataset.onboardingStep) !== step));
  onboardingDots.forEach((dot, i) => dot.classList.toggle('active', i === step - 1));
}

function openCoachWizard({ mode = 'onboarding' } = {}) {
  onboardingMode = mode;
  onboardingStep1Error.textContent = '';
  onboardingStep2Error.textContent = '';

  const isManage = mode === 'manage';
  onboardingCloseBtn.classList.toggle('hidden', !isManage);
  onboardingStep1Title.textContent = isManage ? 'Update Your Stats' : "Let's Get Started";
  onboardingStep3Title.textContent = isManage ? 'Plan Updated' : 'Your Plan Is Ready';
  onboardingStep3Tagline.textContent = isManage
    ? 'Your AI Coach recalculated these daily targets.'
    : 'Your AI Coach set these starting daily targets.';
  onboardingFinishBtn.textContent = isManage ? 'Save & Close' : 'Enter Dashboard';

  const weightKg = mostRecentWeightKg();
  onboardingHeightInput.value = state.settings?.heightCm ? Math.round(state.settings.heightCm * 10) / 10 : '';
  onboardingWeightInput.value = weightKg ? Math.round(weightKg * 10) / 10 : '';
  onboardingAgeInput.value = state.settings?.ageYears ?? '';
  onboardingActivityLevel.value = state.settings?.activityLevel || 'moderate';
  onboardingFitnessGoal.value = state.settings?.fitnessGoal || 'maintain';

  setOnboardingStep(1);
  onboardingOverlay.classList.add('open');
}

function closeCoachWizard() {
  onboardingOverlay.classList.remove('open');
}

onboardingCloseBtn.addEventListener('click', closeCoachWizard);

onboardingStep1Next.addEventListener('click', () => {
  onboardingStep1Error.textContent = '';
  const heightCm = Number(onboardingHeightInput.value);
  const weightKg = Number(onboardingWeightInput.value);
  const ageYears = Number(onboardingAgeInput.value);
  if (!heightCm || heightCm <= 0) {
    onboardingStep1Error.textContent = 'Enter a valid height.';
    return;
  }
  if (!weightKg || weightKg <= 0) {
    onboardingStep1Error.textContent = 'Enter a valid weight.';
    return;
  }
  if (!ageYears || !Number.isInteger(ageYears) || ageYears < 13 || ageYears > 120) {
    onboardingStep1Error.textContent = 'Enter a valid age (13-120).';
    return;
  }
  setOnboardingStep(2);
});

onboardingStep2Back.addEventListener('click', () => setOnboardingStep(1));

onboardingGenerateBtn.addEventListener('click', async () => {
  onboardingStep2Error.textContent = '';
  const payload = {
    heightCm: Number(onboardingHeightInput.value),
    weightKg: Number(onboardingWeightInput.value),
    ageYears: Number(onboardingAgeInput.value),
    activityLevel: onboardingActivityLevel.value,
    fitnessGoal: onboardingFitnessGoal.value
  };

  try {
    const res = await authFetch(`${API}/coach/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate plan');
    state.settings = data;
    document.getElementById('onboardingGoalCalories').textContent = data.calorieGoal ?? 0;
    document.getElementById('onboardingGoalProtein').textContent = `${data.macroGoals?.protein ?? 0}g`;
    document.getElementById('onboardingGoalCarbs').textContent = `${data.macroGoals?.carbs ?? 0}g`;
    document.getElementById('onboardingGoalFat').textContent = `${data.macroGoals?.fat ?? 0}g`;
    setOnboardingStep(3);
    seedProfileDetailsFromOnboarding(payload);
    await Promise.all([loadDay(), loadWeights()]);
  } catch (err) {
    onboardingStep2Error.textContent = err.message;
  }
});

onboardingFinishBtn.addEventListener('click', async () => {
  if (onboardingMode === 'onboarding') {
    try {
      await authFetch(`${API}/onboarding/complete`, { method: 'POST' });
      if (state.user) state.user.onboarded = true;
    } catch {
      // Non-fatal — worst case the wizard reappears next login and the user
      // just clicks through it again.
    }
  }
  closeCoachWizard();
  showToast(onboardingMode === 'manage' ? 'Plan updated' : 'Welcome to PURE MACROS!');
});

// Runs after login/register/session-restore to decide whether the first-launch
// wizard needs to show. Not gated on entering a tab like the old Plan tab was.
async function checkOnboarding() {
  try {
    const res = await authFetch(`${API}/auth/me`);
    if (!res.ok) return;
    const data = await res.json();
    state.user = data;
    if (!data.onboarded) openCoachWizard({ mode: 'onboarding' });
  } catch {
    // A failed follow-up check just means the wizard won't auto-open this
    // time — the session itself was already validated by the caller.
  }
}

// ---------- Plan tab: hub + Meal Planner 9-step wizard ----------
// Separate from the AI Coach onboarding wizard above — this one is scoped to
// the Plan tab specifically and drives the sample recipe hub shown there.
const PW_STEP_COUNT = 9;
let pwCurrentStep = 1;
let pwSkipStep2 = false;
let planState = createEmptyPlanState();

// Step 2 (Name/Weight/Goal Weight/Activity) duplicates data we may already
// have from the profile — Settings > Profile and the weight log use a
// different activity-level vocabulary than this wizard's 4-tier picker, so
// map between them when checking/prefilling.
const PW_ACTIVITY_FROM_SETTINGS = {
  sedentary: 'sedentary',
  light: 'lightly-active',
  moderate: 'active',
  very: 'very-active',
  extreme: 'very-active'
};

function existingProfileStats() {
  const s = state.settings || {};
  return {
    name: s.displayName || '',
    weight: mostRecentWeightKg(),
    goalWeight: s.targetWeightKg ?? null,
    activity: PW_ACTIVITY_FROM_SETTINGS[s.activityLevel] || null
  };
}

function createEmptyPlanState() {
  return {
    goal: null,
    name: '',
    weight: null,
    goalWeight: null,
    activity: null,
    motivation: null,
    challenges: [],
    routineChange: null,
    dietStyle: null,
    mealVolume: 'flexible',
    preferredMacro: 'balanced',
    allergies: [],
    exclusions: [],
    cuisines: {},
    kitchenStock: null,
    cookingSkill: null,
    groceryFrequency: 'weekly',
    shoppingStyle: null,
    cookedVeggies: [],
    rawVeggies: [],
    fruits: [],
    recipeFeedback: {},
    servings: 1,
    priorities: {
      'weight-loss': 1,
      'recipe-variety': 1,
      'delicious-meals': 1,
      'easy-prep': 1,
      'quick-recipes': 1,
      'budget-friendly': 1
    }
  };
}

// Generic single/multi-select handler shared by every "pick one/many
// buttons" widget in the wizard (goals, activity, motivation, challenges,
// diet style, kitchen stock, cooking skill, shopping style, veggie/fruit
// chips). Reads config off the container's data-pw-field/data-pw-select
// attributes so each widget only needs its markup, not bespoke JS.
function setupPwSelectGroup(container, optionSelector) {
  if (!container) return;
  const field = container.dataset.pwField;
  const mode = container.dataset.pwSelect;
  container.addEventListener('click', (e) => {
    const opt = e.target.closest(optionSelector);
    if (!opt || !container.contains(opt)) return;
    const value = opt.dataset.value;
    if (mode === 'single') {
      container.querySelectorAll(optionSelector).forEach((o) => o.classList.toggle('selected', o === opt));
      planState[field] = value;
    } else {
      const isNoneOption = value === 'none';
      if (isNoneOption) {
        const wasSelected = opt.classList.contains('selected');
        container.querySelectorAll(optionSelector).forEach((o) => o.classList.remove('selected'));
        if (!wasSelected) opt.classList.add('selected');
      } else {
        container.querySelector(`${optionSelector}[data-value="none"]`)?.classList.remove('selected');
        opt.classList.toggle('selected');
      }
      planState[field] = [...container.querySelectorAll(`${optionSelector}.selected`)].map((o) => o.dataset.value);
    }
  });
}

setupPwSelectGroup(document.getElementById('pwGoalList'), '.pw-option');
setupPwSelectGroup(document.getElementById('pwActivityList'), '.pw-option');
setupPwSelectGroup(document.getElementById('pwMotivationList'), '.pw-option');
setupPwSelectGroup(document.getElementById('pwChallengeList'), '.pw-option');
setupPwSelectGroup(document.getElementById('pwRoutineTrack'), '.pw-tier-notch');
setupPwSelectGroup(document.getElementById('pwDietGrid'), '.pw-diet-card');
setupPwSelectGroup(document.getElementById('pwKitchenList'), '.pw-desc-option');
setupPwSelectGroup(document.getElementById('pwSkillList'), '.pw-desc-option');
setupPwSelectGroup(document.getElementById('pwShoppingStyleList'), '.pw-option');
setupPwSelectGroup(document.getElementById('pwCookedVeggieList'), '.pw-chip-option');
setupPwSelectGroup(document.getElementById('pwRawVeggieList'), '.pw-chip-option');
setupPwSelectGroup(document.getElementById('pwFruitList'), '.pw-chip-option');

pwNameInput.addEventListener('input', () => { planState.name = pwNameInput.value.trim(); });
pwWeightInput.addEventListener('input', () => { planState.weight = pwWeightInput.value ? Number(pwWeightInput.value) : null; });
pwGoalWeightInput.addEventListener('input', () => { planState.goalWeight = pwGoalWeightInput.value ? Number(pwGoalWeightInput.value) : null; });
pwMealVolumeSelect.addEventListener('change', () => { planState.mealVolume = pwMealVolumeSelect.value; });
pwPreferredMacroSelect.addEventListener('change', () => { planState.preferredMacro = pwPreferredMacroSelect.value; });
pwGroceryFreqSelect.addEventListener('change', () => { planState.groceryFrequency = pwGroceryFreqSelect.value; });

// Allergies: plain checkbox grid, recomputed in full on every change.
pwAllergyGrid.addEventListener('change', () => {
  planState.allergies = [...pwAllergyGrid.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
});

// Food exclusions: free-text tag input backed by planState.exclusions[].
function renderPwExclusionChips() {
  pwExclusionChipsEl.innerHTML = planState.exclusions
    .map((food) => `<span class="pw-chip" data-food="${escapeHtml(food)}">${escapeHtml(food)}<button type="button" class="pw-chip-remove" aria-label="Remove ${escapeHtml(food)}">✕</button></span>`)
    .join('');
}
function addPwExclusion() {
  const value = pwExclusionInput.value.trim();
  if (!value || planState.exclusions.some((f) => f.toLowerCase() === value.toLowerCase())) {
    pwExclusionInput.value = '';
    return;
  }
  planState.exclusions.push(value);
  pwExclusionInput.value = '';
  renderPwExclusionChips();
}
pwExclusionAddBtn.addEventListener('click', addPwExclusion);
pwExclusionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addPwExclusion();
  }
});
pwExclusionChipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.pw-chip-remove');
  if (!btn) return;
  const food = btn.closest('.pw-chip').dataset.food;
  planState.exclusions = planState.exclusions.filter((f) => f !== food);
  renderPwExclusionChips();
});

// Cuisines: each row is an independent Love/Dislike toggle (clicking the
// already-active mood clears it back to neutral).
pwCuisineList.addEventListener('click', (e) => {
  const btn = e.target.closest('.pw-ld-btn');
  if (!btn) return;
  const row = btn.closest('.pw-cuisine-row');
  const cuisine = row.dataset.cuisine;
  const mood = btn.dataset.mood;
  const wasSelected = btn.classList.contains('selected');
  row.querySelectorAll('.pw-ld-btn').forEach((b) => b.classList.remove('selected'));
  if (wasSelected) {
    delete planState.cuisines[cuisine];
  } else {
    btn.classList.add('selected');
    planState.cuisines[cuisine] = mood;
  }
});

// Tinder-style recipe swipe deck: cards are stacked via CSS (top/stack-1/
// stack-2/gone) and the top card is dragged with Pointer Events, which unify
// touch and mouse input. Swiping/clicking right records a like, left a
// dislike, both written into planState.recipeFeedback keyed by recipe id.
const PW_SWIPE_THRESHOLD = 110;
let pwSwipeCards = Array.from(pwSwipeDeck.querySelectorAll('.pw-swipe-card'));
let pwSwipeIndex = 0;
let pwSwipeDrag = null;

function updatePwSwipeStack() {
  pwSwipeCards.forEach((card, i) => {
    const offset = i - pwSwipeIndex;
    card.classList.remove('pw-swipe-top', 'pw-swipe-stack-1', 'pw-swipe-stack-2', 'pw-swipe-gone', 'pw-swipe-dragging');
    card.style.transform = '';
    card.style.opacity = '';
    card.style.transition = '';
    if (offset === 0) card.classList.add('pw-swipe-top');
    else if (offset === 1) card.classList.add('pw-swipe-stack-1');
    else if (offset === 2) card.classList.add('pw-swipe-stack-2');
    else card.classList.add('pw-swipe-gone');
    const likeStamp = card.querySelector('.pw-swipe-stamp-like');
    const nopeStamp = card.querySelector('.pw-swipe-stamp-nope');
    if (likeStamp) likeStamp.style.opacity = '0';
    if (nopeStamp) nopeStamp.style.opacity = '0';
  });
  const remaining = pwSwipeCards.length - pwSwipeIndex;
  pwSwipeEmptyEl.classList.toggle('hidden', remaining > 0);
  pwSwipeLikeBtn.disabled = remaining <= 0;
  pwSwipeDislikeBtn.disabled = remaining <= 0;
}

function resolvePwSwipe(card, direction) {
  planState.recipeFeedback[card.dataset.recipe] = direction;
  card.classList.remove('pw-swipe-dragging');
  card.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
  const flyX = direction === 'like' ? 600 : -600;
  card.style.transform = `translate(${flyX}px, -30px) rotate(${direction === 'like' ? 30 : -30}deg)`;
  card.style.opacity = '0';
  const onEnd = () => {
    card.removeEventListener('transitionend', onEnd);
    pwSwipeIndex += 1;
    updatePwSwipeStack();
  };
  card.addEventListener('transitionend', onEnd);
}

pwSwipeDeck.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.pw-swipe-top');
  if (!card) return;
  card.setPointerCapture(e.pointerId);
  card.classList.add('pw-swipe-dragging');
  pwSwipeDrag = { card, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0 };
});

pwSwipeDeck.addEventListener('pointermove', (e) => {
  if (!pwSwipeDrag || e.pointerId !== pwSwipeDrag.pointerId) return;
  const dx = e.clientX - pwSwipeDrag.startX;
  const dy = e.clientY - pwSwipeDrag.startY;
  pwSwipeDrag.dx = dx;
  const { card } = pwSwipeDrag;
  card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 14}deg)`;
  const strength = Math.min(Math.abs(dx) / PW_SWIPE_THRESHOLD, 1);
  card.querySelector('.pw-swipe-stamp-like').style.opacity = dx > 0 ? String(strength) : '0';
  card.querySelector('.pw-swipe-stamp-nope').style.opacity = dx < 0 ? String(strength) : '0';
});

function endPwSwipeDrag(e) {
  if (!pwSwipeDrag || e.pointerId !== pwSwipeDrag.pointerId) return;
  const { card, dx } = pwSwipeDrag;
  pwSwipeDrag = null;
  if (Math.abs(dx) > PW_SWIPE_THRESHOLD) {
    resolvePwSwipe(card, dx > 0 ? 'like' : 'dislike');
    return;
  }
  card.classList.remove('pw-swipe-dragging');
  card.style.transition = 'transform 0.3s ease';
  card.style.transform = 'translate(0, 0) rotate(0deg)';
  card.querySelector('.pw-swipe-stamp-like').style.opacity = '0';
  card.querySelector('.pw-swipe-stamp-nope').style.opacity = '0';
}
pwSwipeDeck.addEventListener('pointerup', endPwSwipeDrag);
pwSwipeDeck.addEventListener('pointercancel', endPwSwipeDrag);

pwSwipeLikeBtn.addEventListener('click', () => {
  const card = pwSwipeCards[pwSwipeIndex];
  if (card) resolvePwSwipe(card, 'like');
});
pwSwipeDislikeBtn.addEventListener('click', () => {
  const card = pwSwipeCards[pwSwipeIndex];
  if (card) resolvePwSwipe(card, 'dislike');
});

function resetPwSwipeDeck() {
  pwSwipeIndex = 0;
  updatePwSwipeStack();
}
updatePwSwipeStack();

// Household servings scaler — a single global serving count (currently just
// the Dinner card) incremented/decremented by the [-]/[+] stepper.
function setPwServings(value) {
  planState.servings = Math.min(Math.max(value, 1), 12);
  pwServingsValueEl.textContent = String(planState.servings);
}
pwServingsMinus.addEventListener('click', () => setPwServings(planState.servings - 1));
pwServingsPlus.addEventListener('click', () => setPwServings(planState.servings + 1));

// Priority weighting sliders: 3-notch ranges (0=Less Important, 1=Important,
// 2=Very Important), live-written into planState.priorities as they move.
document.querySelectorAll('[data-priority-input]').forEach((input) => {
  input.addEventListener('input', () => {
    planState.priorities[input.dataset.priorityInput] = Number(input.value);
  });
});

// Required-field gate per step — everything else is optional, so the quiz
// stays quick to finish.
function validatePwStep(step) {
  if (step === 1 && !planState.goal) return 'Pick a goal to continue.';
  if (step === 2 && !planState.activity) return 'Select an activity level.';
  if (step === 4 && !planState.dietStyle) return 'Choose an eating style.';
  if (step === 6 && (!planState.kitchenStock || !planState.cookingSkill)) return 'Tell us about your kitchen and cooking skill.';
  if (step === 7 && !planState.shoppingStyle) return 'Pick a shopping style.';
  return null;
}

function pwGoToStep(step) {
  pwCurrentStep = Math.min(Math.max(step, 1), PW_STEP_COUNT);
  document.querySelectorAll('.pw-step').forEach((el) => el.classList.toggle('active', Number(el.dataset.pwStep) === pwCurrentStep));
  pwStepNumberEl.textContent = String(pwCurrentStep);
  pwProgressFillEl.style.width = `${(pwCurrentStep / PW_STEP_COUNT) * 100}%`;
  pwBackBtn.classList.toggle('hidden', pwCurrentStep === 1);
  pwNextBtn.textContent = pwCurrentStep === PW_STEP_COUNT ? 'Generate My Plan' : 'Continue';
  pwErrorEl.textContent = '';
  pwBodyEl.scrollTop = 0;
}

function resetPwUI() {
  planState = createEmptyPlanState();
  document.querySelectorAll('.pw-option.selected, .pw-diet-card.selected, .pw-desc-option.selected, .pw-chip-option.selected, .pw-tier-notch.selected, .pw-ld-btn.selected').forEach((el) => el.classList.remove('selected'));
  pwAllergyGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  pwNameInput.value = '';
  pwWeightInput.value = '';
  pwGoalWeightInput.value = '';
  pwMealVolumeSelect.value = 'flexible';
  pwPreferredMacroSelect.value = 'balanced';
  pwGroceryFreqSelect.value = 'weekly';
  pwExclusionInput.value = '';
  renderPwExclusionChips();
  setPwServings(1);
  resetPwSwipeDeck();
  document.querySelectorAll('[data-priority-input]').forEach((input) => { input.value = 1; });

  const stats = existingProfileStats();
  pwSkipStep2 = Boolean(stats.name && stats.weight && stats.goalWeight && stats.activity);
  if (pwSkipStep2) {
    planState.name = stats.name;
    planState.weight = stats.weight;
    planState.goalWeight = stats.goalWeight;
    planState.activity = stats.activity;
    pwNameInput.value = stats.name;
    pwWeightInput.value = stats.weight;
    pwGoalWeightInput.value = stats.goalWeight;
    pwActivityList.querySelector(`.pw-option[data-value="${stats.activity}"]`)?.classList.add('selected');
  }

  pwGoToStep(1);
}

function openPlanWizard() {
  resetPwUI();
  planWizardOverlay.classList.add('open');
}
function closePlanWizard() {
  planWizardOverlay.classList.remove('open');
}

pwSkipBtn.addEventListener('click', () => {
  closePlanWizard();
  renderPlanTab();
});

pwBackBtn.addEventListener('click', () => {
  pwGoToStep(pwCurrentStep === 3 && pwSkipStep2 ? 1 : pwCurrentStep - 1);
});

pwNextBtn.addEventListener('click', async () => {
  const err = validatePwStep(pwCurrentStep);
  if (err) {
    pwErrorEl.textContent = err;
    return;
  }
  if (pwCurrentStep < PW_STEP_COUNT) {
    pwGoToStep(pwCurrentStep === 1 && pwSkipStep2 ? 3 : pwCurrentStep + 1);
    return;
  }

  pwNextBtn.disabled = true;
  try {
    const res = await authFetch(`${API}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: planState })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save your plan');
    state.mealPlan = data;
    closePlanWizard();
    renderPlanTab();
    showToast('Your meal plan is ready!');
  } catch (e) {
    pwErrorEl.textContent = e.message;
  } finally {
    pwNextBtn.disabled = false;
  }
});

planStartQuizBtn.addEventListener('click', openPlanWizard);
planRetakeQuizBtn.addEventListener('click', openPlanWizard);

// Sample high-protein recipes shown in the hub once the quiz is complete —
// carbs/protein/fat are rendered as high-contrast pills per the spec.
// Ingredient lines containing {{veggie}}/{{fruit}} and name templates
// containing the same tokens are resolved per-user in buildPlanRecipes()
// from their onboarding quiz veggie/fruit picks.
const PLAN_SAMPLE_RECIPES = [
  {
    id: 'grilled-chicken-quinoa-bowl',
    name: 'Grilled Chicken & Quinoa Bowl',
    kcal: 420, protein: 38, carbs: 34, fat: 12,
    img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80',
    ingredientsByUnit: {
      metric: [
        '170g grilled chicken breast, sliced',
        '150g cooked quinoa',
        '75g cherry tomatoes, halved',
        '30g cucumber, diced',
        '30g crumbled feta cheese',
        '15ml olive oil & lemon dressing'
      ],
      imperial: [
        '6 oz grilled chicken breast, sliced',
        '3/4 cup cooked quinoa',
        '1/2 cup cherry tomatoes, halved',
        '1/4 cup cucumber, diced',
        '2 tbsp crumbled feta cheese',
        '1 tbsp olive oil & lemon dressing'
      ]
    },
    instructionsByUnit: {
      metric: [
        'Season the chicken breast with salt, pepper, and a pinch of paprika.',
        'Grill over medium-high heat for 6-7 minutes per side, until it reaches 74°C internally.',
        'Rinse the quinoa, then simmer in a 2:1 water ratio for 15 minutes and fluff with a fork.',
        'Let the chicken rest 5 minutes, then slice and arrange over the quinoa.',
        'Top with cherry tomatoes, cucumber, and feta.',
        'Drizzle with the olive oil and lemon dressing just before serving.'
      ],
      imperial: [
        'Season the chicken breast with salt, pepper, and a pinch of paprika.',
        'Grill over medium-high heat for 6-7 minutes per side, until it reaches 165°F internally.',
        'Rinse the quinoa, then simmer in a 2:1 water ratio for 15 minutes and fluff with a fork.',
        'Let the chicken rest 5 minutes, then slice and arrange over the quinoa.',
        'Top with cherry tomatoes, cucumber, and feta.',
        'Drizzle with the olive oil and lemon dressing just before serving.'
      ]
    }
  },
  {
    id: 'herb-crusted-salmon-asparagus',
    name: 'Herb-Crusted Salmon with Asparagus',
    kcal: 390, protein: 34, carbs: 10, fat: 22,
    img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80',
    ingredients: [
      '6 oz salmon fillet',
      '1 tbsp fresh herbs (dill, parsley), chopped',
      '1 tsp garlic, minced',
      '1 bunch asparagus, trimmed',
      '1 tbsp olive oil',
      '1/2 lemon, sliced'
    ],
    instructions: [
      'Preheat the oven to 400°F (200°C).',
      'Pat the salmon dry and press the chopped herbs and garlic onto the top.',
      'Toss the asparagus with olive oil, salt, and pepper on a lined baking sheet.',
      'Place the salmon on the same sheet and top with lemon slices.',
      'Roast for 12-14 minutes, until the salmon flakes easily with a fork.',
      'Serve the salmon over the roasted asparagus.'
    ]
  },
  {
    id: 'turkey-sweet-potato-skillet',
    name: 'Turkey & Sweet Potato Skillet',
    kcal: 410, protein: 36, carbs: 40, fat: 10,
    img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
    ingredients: [
      '6 oz ground turkey (93% lean)',
      '1 cup sweet potato, diced',
      '1/2 cup yellow onion, diced',
      '1/2 cup bell peppers, diced',
      '1 tsp smoked paprika',
      '1 tsp olive oil'
    ],
    instructions: [
      'Heat the olive oil in a skillet over medium heat and add the sweet potato.',
      'Cover and cook for 8-10 minutes, stirring occasionally, until fork-tender.',
      'Push the sweet potato aside and add the ground turkey, breaking it apart as it browns.',
      'Stir in the onion, bell peppers, and smoked paprika.',
      'Cook for another 5-6 minutes until the turkey is fully cooked and vegetables have softened.',
      'Season with salt and pepper to taste and serve straight from the skillet.'
    ]
  },
  {
    id: 'high-protein-beef-stir-fry',
    name: 'High-Protein Beef Stir-Fry',
    kcal: 460, protein: 42, carbs: 30, fat: 16,
    img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80',
    ingredientsByUnit: {
      metric: [
        '170g lean beef sirloin, thinly sliced',
        '75g broccoli florets',
        '60g carrots, julienned',
        '75g snap peas',
        '30ml low-sodium soy sauce',
        '5ml sesame oil & 5g ginger-garlic, minced'
      ],
      imperial: [
        '6 oz lean beef sirloin, thinly sliced',
        '1 cup broccoli florets',
        '1/2 cup carrots, julienned',
        '1/2 cup snap peas',
        '2 tbsp low-sodium soy sauce',
        '1 tsp sesame oil & 1 tsp ginger-garlic, minced'
      ]
    },
    instructionsByUnit: {
      metric: [
        'Heat sesame oil in a wok or large skillet over high heat.',
        'Sear the sliced beef for 1-2 minutes per side until browned; remove and set aside.',
        'Add the ginger and garlic to the pan and stir for 30 seconds until fragrant.',
        'Add the broccoli, carrots, and snap peas, stir-frying for 3-4 minutes until crisp-tender.',
        'Return the beef to the pan and stir in the soy sauce.',
        'Toss everything together for 1 minute more and serve hot.'
      ],
      imperial: [
        'Heat sesame oil in a wok or large skillet over high heat.',
        'Sear the sliced beef for 1-2 minutes per side until browned; remove and set aside.',
        'Add the ginger and garlic to the pan and stir for 30 seconds until fragrant.',
        'Add the broccoli, carrots, and snap peas, stir-frying for 3-4 minutes until crisp-tender.',
        'Return the beef to the pan and stir in the soy sauce.',
        'Toss everything together for 1 minute more and serve hot.'
      ]
    }
  },
  {
    id: 'cottage-cheese-egg-white-scramble',
    name: 'Cottage Cheese & Egg White Scramble',
    nameTemplate: 'Cottage Cheese & Egg White Scramble with {{veggie}}',
    kcal: 320, protein: 40, carbs: 8, fat: 10,
    img: 'https://images.unsplash.com/photo-1687630433865-f86f07be989a?auto=format&fit=crop&w=800&q=80',
    ingredients: [
      '1 cup egg whites',
      '1/2 cup low-fat cottage cheese',
      '1 cup {{veggie}}, chopped',
      '1 tsp olive oil',
      'Salt, pepper & chili flakes, to taste'
    ],
    instructions: [
      'Heat the olive oil in a nonstick pan over medium heat.',
      'Add the {{veggie}} and sauté for 2-3 minutes until just tender.',
      'Pour in the egg whites and let them set slightly around the edges.',
      'Gently fold and scramble the eggs with the {{veggie}} for 2-3 minutes.',
      'Remove from heat and fold in the cottage cheese.',
      'Season with salt, pepper, and chili flakes before serving.'
    ]
  },
  {
    id: 'greek-yogurt-protein-parfait',
    name: 'Greek Yogurt Protein Parfait',
    nameTemplate: 'Greek Yogurt Protein Parfait with {{fruit}}',
    kcal: 300, protein: 30, carbs: 28, fat: 6,
    img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=400&q=80',
    ingredients: [
      '1 cup plain nonfat Greek yogurt',
      '1/2 cup {{fruit}}',
      '2 tbsp granola',
      '1 tsp honey',
      '1 tbsp chia seeds'
    ],
    instructions: [
      'Spoon half the Greek yogurt into the bottom of a glass or jar.',
      'Layer in half the {{fruit}} and a sprinkle of granola.',
      'Repeat with the remaining yogurt, {{fruit}}, and granola.',
      'Drizzle honey over the top and finish with a sprinkle of chia seeds.',
      'Serve immediately, or chill for up to 12 hours for meal prep.'
    ]
  }
];

// Turns a quiz chip's kebab-case data-value (e.g. "bell-peppers") into the
// same label shown on its button ("Bell Peppers").
function pwSlugLabel(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Resolves the {{veggie}}/{{fruit}} placeholders in PLAN_SAMPLE_RECIPES
// against the user's onboarding quiz picks (falling back to Spinach/
// Blueberries when nothing was selected), then de-dupes by recipe id so the
// rendered hub can never show the same meal twice.
function buildPlanRecipes() {
  const prefs = state.mealPlan?.preferences || {};
  const veggieSlug = prefs.cookedVeggies?.[0] || prefs.rawVeggies?.[0] || null;
  const fruitSlug = prefs.fruits?.[0] || null;
  const veggieLabel = veggieSlug ? pwSlugLabel(veggieSlug) : 'Spinach';
  const fruitLabel = fruitSlug ? pwSlugLabel(fruitSlug) : 'Blueberries';

  const fillTokens = (text) => text.replace(/\{\{veggie\}\}/g, veggieLabel).replace(/\{\{fruit\}\}/g, fruitLabel);

  const seen = new Set();
  const recipes = [];
  for (const r of PLAN_SAMPLE_RECIPES) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const dualUnit = Boolean(r.ingredientsByUnit);
    recipes.push({
      ...r,
      name: fillTokens(r.nameTemplate || r.name),
      ingredients: dualUnit ? undefined : r.ingredients.map(fillTokens),
      instructions: dualUnit ? undefined : r.instructions.map(fillTokens),
      ingredientsByUnit: dualUnit ? {
        metric: r.ingredientsByUnit.metric.map(fillTokens),
        imperial: r.ingredientsByUnit.imperial.map(fillTokens)
      } : undefined,
      instructionsByUnit: dualUnit ? {
        metric: r.instructionsByUnit.metric.map(fillTokens),
        imperial: r.instructionsByUnit.imperial.map(fillTokens)
      } : undefined
    });
  }
  return recipes;
}

// Resolves a recipe's ingredient/instruction lines for the active
// userUnitPreference — recipes without dual-unit data just show their
// single (imperial-authored) list regardless of the toggle.
function getRecipeIngredientLines(recipe) {
  return recipe.ingredientsByUnit ? recipe.ingredientsByUnit[userUnitPreference] : recipe.ingredients;
}
function getRecipeInstructionLines(recipe) {
  return recipe.instructionsByUnit ? recipe.instructionsByUnit[userUnitPreference] : recipe.instructions;
}

const PW_GOAL_LABELS = {
  'lose-weight': 'losing weight',
  'hit-macros': 'hitting your macros',
  'eat-healthy': 'eating healthy',
  'gain-weight': 'gaining weight',
  'save-time': 'saving time',
  'meal-prep': 'weekly meal prepping',
  'dine-out': 'healthy dining out',
  'learn-cook': 'learning to cook',
  'spend-less': 'spending less on food',
  'try-new': 'trying something new'
};

let currentPlanRecipes = [];

function renderPlanHub() {
  const prefs = state.mealPlan?.preferences || {};
  const goalLabel = PW_GOAL_LABELS[prefs.goal];
  planHubSubtitleEl.textContent = goalLabel ? `Focused on ${goalLabel} · high-protein picks` : 'High-protein picks for your goals';
  currentPlanRecipes = buildPlanRecipes();
  planRecipeGridEl.innerHTML = currentPlanRecipes.map((r) => `
    <div class="plan-recipe-card" data-recipe-id="${r.id}" role="button" tabindex="0">
      ${r.img ? `<div class="plan-recipe-card-media"><img class="plan-recipe-thumb" src="${r.img}" alt="${escapeHtml(r.name)}" loading="lazy" /></div>` : ''}
      <div class="plan-recipe-card-body">
        <div class="plan-recipe-card-top">
          <span class="plan-recipe-name">${escapeHtml(r.name)}</span>
          <span class="plan-recipe-kcal">${r.kcal} kcal</span>
        </div>
        <div class="plan-recipe-macros">
          <div class="plan-macro-pill protein"><span class="plan-macro-pill-value">${r.protein}g</span><span class="plan-macro-pill-label">Protein</span></div>
          <div class="plan-macro-pill carbs"><span class="plan-macro-pill-value">${r.carbs}g</span><span class="plan-macro-pill-label">Carbs</span></div>
          <div class="plan-macro-pill fat"><span class="plan-macro-pill-value">${r.fat}g</span><span class="plan-macro-pill-label">Fat</span></div>
        </div>
      </div>
    </div>
  `).join('');
}

// ---------- Recipe Details Modal (sliding sheet) ----------
const recipeModalEl = document.getElementById('recipe-modal');
const recipeModalSheetEl = document.getElementById('recipeModalSheet');
const recipeModalBackdropEl = document.getElementById('recipeModalBackdrop');
const recipeModalCloseBtn = document.getElementById('recipeModalCloseBtn');
const recipeModalImgEl = document.getElementById('recipeModalImg');
const recipeModalTitleEl = document.getElementById('recipeModalTitle');
const recipeModalKcalEl = document.getElementById('recipeModalKcal');
const recipeModalProteinEl = document.getElementById('recipeModalProtein');
const recipeModalCarbsEl = document.getElementById('recipeModalCarbs');
const recipeModalFatEl = document.getElementById('recipeModalFat');
const recipeModalIngredientsEl = document.getElementById('recipeModalIngredients');
const recipeModalInstructionsEl = document.getElementById('recipeModalInstructions');
const recipeModalPrepTimeEl = document.getElementById('recipeModalPrepTime');
const recipeModalFiberEl = document.getElementById('recipeModalFiber');
const recipeModalTabsEl = document.getElementById('recipeModalTabs');
const recipeModalIngredientsSectionEl = document.getElementById('recipeModalIngredientsSection');
const recipeModalInstructionsSectionEl = document.getElementById('recipeModalInstructionsSection');
const recipeModalMealSelectEl = document.getElementById('recipeModalMealSelect');
const recipeModalAddToDiaryBtn = document.getElementById('recipeModalAddToDiaryBtn');

// Tracks whichever recipe is currently open in the modal so the Unit System
// toggle can re-render its ingredient/instruction lines in place without
// having to reopen the sheet.
let currentRecipeModalRecipe = null;

function renderRecipeModalUnits() {
  if (!currentRecipeModalRecipe) return;
  recipeModalIngredientsEl.innerHTML = getRecipeIngredientLines(currentRecipeModalRecipe).map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  recipeModalInstructionsEl.innerHTML = getRecipeInstructionLines(currentRecipeModalRecipe).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
}

function setRecipeModalTab(tab) {
  recipeModalTabsEl.querySelectorAll('.recipe-modal-tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.recipeTab === tab));
  recipeModalIngredientsSectionEl.classList.toggle('hidden', tab !== 'ingredients');
  recipeModalInstructionsSectionEl.classList.toggle('hidden', tab !== 'directions');
}

recipeModalTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.recipe-modal-tab-btn');
  if (btn) setRecipeModalTab(btn.dataset.recipeTab);
});

function openRecipeModal(recipe) {
  currentRecipeModalRecipe = recipe;
  recipeModalImgEl.src = recipe.img || '';
  recipeModalImgEl.alt = recipe.name;
  recipeModalTitleEl.textContent = recipe.name;
  recipeModalKcalEl.textContent = `${recipe.kcal} kcal`;
  recipeModalProteinEl.textContent = `${recipe.protein}g`;
  recipeModalCarbsEl.textContent = `${recipe.carbs}g`;
  recipeModalFatEl.textContent = `${recipe.fat}g`;

  recipeModalPrepTimeEl.classList.toggle('hidden', recipe.prep_time === undefined);
  if (recipe.prep_time !== undefined) recipeModalPrepTimeEl.textContent = `⏱ ${recipe.prep_time} min`;
  recipeModalFiberEl.classList.toggle('hidden', recipe.fiber === undefined);
  if (recipe.fiber !== undefined) recipeModalFiberEl.textContent = `🌾 ${recipe.fiber}g fiber`;

  setRecipeModalTab('ingredients');
  renderRecipeModalUnits();
  recipeModalEl.classList.remove('hidden');
  // Force a reflow before adding .open so the translate3d transition plays
  // from its 100% starting position instead of jumping straight to 0.
  void recipeModalSheetEl.offsetHeight;
  requestAnimationFrame(() => recipeModalEl.classList.add('open'));
}

function closeRecipeModal() {
  if (recipeModalEl.classList.contains('hidden')) return;
  recipeModalEl.classList.remove('open');
  const onEnd = (e) => {
    if (e.target !== recipeModalSheetEl || e.propertyName !== 'transform') return;
    recipeModalSheetEl.removeEventListener('transitionend', onEnd);
    recipeModalEl.classList.add('hidden');
  };
  recipeModalSheetEl.addEventListener('transitionend', onEnd);
}

planRecipeGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.plan-recipe-card');
  if (!card) return;
  const recipe = currentPlanRecipes.find((r) => r.id === card.dataset.recipeId);
  if (recipe) openRecipeModal(recipe);
});
planRecipeGridEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.plan-recipe-card');
  if (!card) return;
  e.preventDefault();
  const recipe = currentPlanRecipes.find((r) => r.id === card.dataset.recipeId);
  if (recipe) openRecipeModal(recipe);
});
recipeModalCloseBtn.addEventListener('click', closeRecipeModal);
recipeModalBackdropEl.addEventListener('click', closeRecipeModal);

recipeModalAddToDiaryBtn.addEventListener('click', async () => {
  const recipe = currentRecipeModalRecipe;
  if (!recipe) return;
  const kcal = recipe.calories ?? recipe.kcal ?? 0;
  recipeModalAddToDiaryBtn.disabled = true;
  try {
    const res = await authFetch(`${API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        meal: recipeModalMealSelectEl.value,
        foodId: CUSTOM_FOOD_ID,
        grams: 100,
        customFood: { name: recipe.name, kcal, protein: recipe.protein || 0, carbs: recipe.carbs || 0, fat: recipe.fat || 0 }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add recipe to diary');
    state.entries.push(data);
    render();
    refreshStreak();
    showToast(`Added ${data.name} to diary`);
    closeRecipeModal();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    recipeModalAddToDiaryBtn.disabled = false;
  }
});

function renderPlanTab() {
  const onboarded = Boolean(state.mealPlan?.onboarded);
  planEmptyStateEl.classList.toggle('hidden', onboarded);
  planHubEl.classList.toggle('hidden', !onboarded);
  if (onboarded) renderPlanHub();
}

// Entry point for the bottom-nav Plan button: shows the intro landing panel
// (with its own "Get started" CTA) when no plan exists yet, or the recipe
// hub immediately when the quiz has already been completed.
function openPlanTabView() {
  renderPlanTab();
}

async function loadPlanPreferences() {
  try {
    const res = await authFetch(`${API}/plan`);
    if (!res.ok) throw new Error('Failed to load plan');
    state.mealPlan = await res.json();
  } catch {
    state.mealPlan = { onboarded: false, preferences: null };
  }
  if (currentTab === 'plan') renderPlanTab();
}

// ---------- Shared sub-view scaffolding (More tab ecosystem) ----------
// Tracks whichever view (a tab, or another sub-view) sits directly behind
// the currently-open one and instantly display:none's it for the duration —
// opacity/transform alone leave the covered view fully composited, which is
// what let its text bleed through the sub-view above it on iOS Safari.
const subViewStack = [];
function currentBase() {
  return subViewStack[subViewStack.length - 1] || document.querySelector('.tab-view:not(.hidden)');
}
function openSubView(view) {
  const base = currentBase();
  if (base) base.classList.add('subview-covered');
  subViewStack.push(view);
  view.classList.add('open');
}
function closeSubView(view) {
  view.classList.remove('open');
  const idx = subViewStack.indexOf(view);
  if (idx !== -1) subViewStack.splice(idx, 1);
  const base = currentBase();
  if (base) base.classList.remove('subview-covered');
}

// Native iOS-style "swipe from the left edge to pop the screen" gesture for
// every full-screen .settings-view sub-view (the More tab's 13 subpages plus
// their nested Settings screens). Purely additive — it drives the same
// .settings-back-btn each view already closes through, so the manual back
// arrows keep working exactly as before whether or not this gesture fires.
(function setupSubViewSwipeBack() {
  const EDGE_ZONE = 24; // px from the left edge a swipe must start within
  const CLOSE_THRESHOLD = 80; // px of horizontal travel to commit to closing

  document.querySelectorAll('.settings-view').forEach((view) => {
    let startX = null;
    let startY = null;
    let dragDx = 0;
    let canceled = false;

    function onStart(e) {
      if (!view.classList.contains('open')) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE_ZONE) return;
      startX = touch.clientX;
      startY = touch.clientY;
      dragDx = 0;
      canceled = false;
      view.classList.add('dragging');
    }

    function onMove(e) {
      if (startX === null || canceled) return;
      const touch = e.touches[0];
      const rawDx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // A mostly-vertical drag is the view's own scroll, not a swipe-back —
      // bail out and stop touching .style.transform for the rest of this touch.
      if (Math.abs(dy) > Math.abs(rawDx) && Math.abs(dy) > 12) {
        canceled = true;
        view.classList.remove('dragging');
        view.style.transform = '';
        return;
      }
      dragDx = Math.max(0, rawDx);
      view.style.transform = `translateX(${dragDx}px)`;
    }

    function onEnd() {
      if (startX === null) return;
      view.classList.remove('dragging');
      view.style.transform = '';
      if (!canceled && dragDx > CLOSE_THRESHOLD) {
        view.querySelector('.settings-back-btn')?.click();
      }
      startX = null;
      startY = null;
      dragDx = 0;
    }

    view.addEventListener('touchstart', onStart, { passive: true });
    view.addEventListener('touchmove', onMove, { passive: true });
    view.addEventListener('touchend', onEnd);
    view.addEventListener('touchcancel', onEnd);
  });
})();

// panels: [{ key, el }]. Wires a .log-subtab-btn row to show/hide matching
// [data-tab-panel] elements, mirroring the existing switchLogSubtab idiom.
function initFlatTabs(tabsEl, panels, onSwitch) {
  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.log-subtab-btn');
    if (!btn) return;
    const key = btn.dataset.tab;
    tabsEl.querySelectorAll('.log-subtab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    panels.forEach((p) => p.el.classList.toggle('hidden', p.key !== key));
    onSwitch(key);
  });
}

// r=70 ring progress, matching RING_CIRCUMFERENCE (the sleep ring / any
// future 160x160 ring built the same way).
function setRingProgress(circleEl, pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  circleEl.style.strokeDasharray = RING_CIRCUMFERENCE;
  circleEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - clamped);
}

// Parameterized copies of renderMacroRings/renderNutrientsList (which write
// into the Progress tab's fixed containers) so new More-tab screens can
// reuse the exact same rendering technique against their own containers.
function renderMacroRingsInto(container, averages) {
  const calsFromProtein = (averages.protein || 0) * 4;
  const calsFromCarbs = (averages.carbs || 0) * 4;
  const calsFromFat = (averages.fat || 0) * 9;
  const total = calsFromProtein + calsFromCarbs + calsFromFat;
  const macros = [
    { key: 'protein', label: 'Protein', cals: calsFromProtein },
    { key: 'carbs', label: 'Carbs', cals: calsFromCarbs },
    { key: 'fat', label: 'Fat', cals: calsFromFat }
  ];
  container.innerHTML = '';
  for (const m of macros) {
    const pct = total > 0 ? Math.round((m.cals / total) * 100) : 0;
    const offset = MACRO_RING_CIRCUMFERENCE * (1 - pct / 100);
    const item = document.createElement('div');
    item.className = 'macro-ring-item';
    item.innerHTML = `
      <div class="macro-ring-wrap">
        <svg viewBox="0 0 80 80" class="macro-ring-svg">
          <circle cx="40" cy="40" r="34" class="ring-track" stroke-width="8" />
          <circle cx="40" cy="40" r="34" class="ring-progress macro-ring-${m.key}" stroke-width="8"
            stroke-dasharray="${MACRO_RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="macro-ring-pct">${pct}%</span>
      </div>
      <span class="macro-ring-label">${m.label}</span>
    `;
    container.appendChild(item);
  }
}

function renderNutrientsListInto(container, averages) {
  container.innerHTML = '';
  for (const key of Object.keys(NUTRIENT_LABELS)) {
    const li = document.createElement('li');
    li.className = 'nutrient-row';
    li.innerHTML = `<span class="nutrient-name">${NUTRIENT_LABELS[key]}</span><span class="nutrient-value">${averages[key] ?? 0}${NUTRIENT_UNITS[key]}</span>`;
    container.appendChild(li);
  }
}

// ---------- My Profile ----------
const profileView = document.getElementById('profileView');
const profileBackBtn = document.getElementById('profileBackBtn');
const profileViewTitleEl = document.getElementById('profileViewTitle');
const profileHeroNameEl = document.getElementById('profileHeroName');
const profileHeroSynclineEl = profileView.querySelector('.profile-hero-syncline');
const profileScoreWeightLostEl = document.getElementById('profileScoreWeightLost');
const profileScoreFriendsEl = document.getElementById('profileScoreFriends');
const profileEditRowBtn = document.getElementById('profileEditRowBtn');

function openProfileView() {
  const username = state.user?.username || '—';
  profileViewTitleEl.textContent = username;
  profileHeroNameEl.textContent = username;
  profileHeroSynclineEl.textContent = formatMfpLastSync(state.lastSyncAt);

  const summary = computeWeightSummary();
  const stoneLost = summary ? Math.max(0, Math.round((kgToLbs(summary.lost) / 14) * 10) / 10) : 0;
  profileScoreWeightLostEl.textContent = `[ ${stoneLost} st Lost ]`;
  profileScoreFriendsEl.textContent = `[ ${FRIENDS.length} Friends ]`;

  openSubView(profileView);
}
profileBackBtn.addEventListener('click', () => closeSubView(profileView));

profileEditRowBtn.addEventListener('click', () => openProfileDetailsView('profile'));

// ---------- Workout Routines ----------
const workoutsView = document.getElementById('workoutsView');
const workoutsBackBtn = document.getElementById('workoutsBackBtn');
const workoutsAddBtn = document.getElementById('workoutsAddBtn');
const routineCreateForm = document.getElementById('routineCreateForm');
const routineNameInput = document.getElementById('routineNameInput');
const routineExerciseRowsEl = document.getElementById('routineExerciseRows');
const routineAddExerciseRowBtn = document.getElementById('routineAddExerciseRowBtn');
const routineCreateError = document.getElementById('routineCreateError');
const routineCancelBtn = document.getElementById('routineCancelBtn');
const routineSaveBtn = document.getElementById('routineSaveBtn');
const routinesListEl = document.getElementById('routinesList');

function addRoutineExerciseRow() {
  const row = document.createElement('div');
  row.className = 'routine-exercise-row';
  row.innerHTML = `
    <input type="text" placeholder="Exercise name" class="routine-ex-name" />
    <input type="number" placeholder="Sets" min="1" class="routine-ex-sets" />
    <input type="number" placeholder="Reps" min="1" class="routine-ex-reps" />
  `;
  routineExerciseRowsEl.appendChild(row);
}
routineAddExerciseRowBtn.addEventListener('click', addRoutineExerciseRow);

async function loadRoutines() {
  try {
    const res = await authFetch(`${API}/routines`);
    if (!res.ok) throw new Error('Failed to load routines');
    state.routines = await res.json();
    renderRoutines();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderRoutines() {
  routinesListEl.innerHTML = '';
  if (state.routines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No routines yet — tap + to create one.';
    routinesListEl.appendChild(empty);
    return;
  }
  for (const r of state.routines) {
    const card = document.createElement('section');
    card.className = 'card routine-card';
    card.innerHTML = `
      <h3 class="routine-card-name">${escapeHtml(r.name)}</h3>
      <ul class="routine-exercise-list">
        ${r.exercises.map((ex) => `<li class="routine-exercise-item"><span class="routine-exercise-item-name">${escapeHtml(ex.name)}</span><span class="routine-exercise-item-meta">${ex.sets} × ${ex.reps}</span></li>`).join('')}
      </ul>
      <button type="button" class="routine-start-btn" data-start-routine="${r.id}">Start Workout Routine</button>
      <button type="button" class="delete-btn" data-delete-routine="${r.id}" aria-label="Delete routine">✕</button>
    `;
    routinesListEl.appendChild(card);
  }
}

routinesListEl.addEventListener('click', async (e) => {
  const startBtn = e.target.closest('[data-start-routine]');
  if (startBtn) {
    const routine = state.routines.find((r) => r.id === startBtn.dataset.startRoutine);
    if (!routine) return;
    try {
      const today = todayStr();
      for (const ex of routine.exercises) {
        await authFetch(`${API}/exercise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: today, type: 'strength', name: ex.name, minutes: ex.sets * ex.reps, caloriesBurned: 0 })
        });
      }
      await loadExercise();
      showToast(`${routine.name} logged to today`);
    } catch {
      showToast('Failed to start routine', true);
    }
    return;
  }
  const delBtn = e.target.closest('[data-delete-routine]');
  if (delBtn) {
    await authFetch(`${API}/routines/${delBtn.dataset.deleteRoutine}`, { method: 'DELETE' });
    await loadRoutines();
  }
});

function openWorkoutsView() {
  routineCreateForm.classList.add('hidden');
  loadRoutines();
  openSubView(workoutsView);
}
workoutsBackBtn.addEventListener('click', () => closeSubView(workoutsView));
workoutsAddBtn.addEventListener('click', () => {
  routineCreateError.textContent = '';
  routineNameInput.value = '';
  routineExerciseRowsEl.innerHTML = '';
  addRoutineExerciseRow();
  routineCreateForm.classList.remove('hidden');
  routineCreateForm.scrollIntoView({ behavior: 'smooth' });
});
routineCancelBtn.addEventListener('click', () => routineCreateForm.classList.add('hidden'));
routineSaveBtn.addEventListener('click', async () => {
  routineCreateError.textContent = '';
  const name = routineNameInput.value.trim();
  if (!name) { routineCreateError.textContent = 'Enter a routine name.'; return; }
  const exercises = [...routineExerciseRowsEl.querySelectorAll('.routine-exercise-row')]
    .map((row) => ({
      name: row.querySelector('.routine-ex-name').value.trim(),
      sets: Number(row.querySelector('.routine-ex-sets').value),
      reps: Number(row.querySelector('.routine-ex-reps').value)
    }))
    .filter((ex) => ex.name && ex.sets > 0 && ex.reps > 0);
  if (exercises.length === 0) { routineCreateError.textContent = 'Add at least one exercise with sets and reps.'; return; }
  try {
    const res = await authFetch(`${API}/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, exercises })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save routine');
    routineCreateForm.classList.add('hidden');
    await loadRoutines();
    showToast('Routine saved');
  } catch (err) {
    routineCreateError.textContent = err.message;
  }
});

// ---------- Workout Routines: Explore / My Routines directory ----------
const workoutRoutinesView = document.getElementById('workout-routines-view');
const wrBackBtn = document.getElementById('wrBackBtn');
const wrTabsEl = document.getElementById('wrTabs');
const wrExplorePanel = document.getElementById('wrExplorePanel');
const wrMyRoutinesPanel = document.getElementById('wrMyRoutinesPanel');
const wrExploreListEl = document.getElementById('wrExploreList');
const wrTrackRepsBtn = document.getElementById('wrTrackRepsBtn');

// photo ids reused across categories that weren't given their own Unsplash shots
//
// Open-source (Pexels-licensed, free for commercial use, no attribution
// required) exercise loops, reused across categories the same way the
// Unsplash photo ids above are — a handful of verified clips is enough to
// cover all 11 Explore categories without a bespoke shoot per card.
const WORKOUT_VIDEO = {
  pushups: 'https://videos.pexels.com/video-files/6388436/6388436-uhd_2560_1440_25fps.mp4',
  squats: 'https://videos.pexels.com/video-files/5319755/5319755-uhd_2560_1440_25fps.mp4',
  stretchA: 'https://videos.pexels.com/video-files/4608975/4608975-hd_1920_1080_25fps.mp4',
  jumpingJacks: 'https://videos.pexels.com/video-files/6326725/6326725-hd_1920_1080_25fps.mp4',
  yoga: 'https://videos.pexels.com/video-files/3327752/3327752-hd_1920_1080_24fps.mp4',
  mat: 'https://videos.pexels.com/video-files/6525485/6525485-hd_1920_1080_25fps.mp4',
  stretchB: 'https://videos.pexels.com/video-files/7591716/7591716-uhd_1440_2560_25fps.mp4'
};

const WORKOUT_CATEGORIES = [
  { title: 'Stretch & Strength', desc: 'Loosen tight muscles and build a stable foundation with full-range mobility flows.', cards: [
    { photo: '1544367567-0f2fcb009e0b', title: 'Morning Mobility Flow', duration: '12 min', equipment: 'No Equipment', desc: 'Wake up joints and prime your spine before the day gets moving.', video: WORKOUT_VIDEO.stretchA, calories: 45, timeline: [
      { time: 0, move: 'Cat-Cow Spinal Rolls', cue: 'Move slow through flexion and extension, breathing with each rep.' },
      { time: 180, move: "World's Greatest Stretch", cue: 'Rotate through the thoracic spine, keep the front knee stacked over the ankle.' },
      { time: 420, move: 'Standing Reach & Fold', cue: 'Hinge from the hips and let the arms hang heavy toward the floor.' },
      { time: 600, move: 'Neck & Shoulder Rolls', cue: 'Finish by releasing tension through the neck and shoulders.' }
    ]},
    { photo: '1571019613454-1cb2f99b2d8b', title: 'Deep Hip Opener Series', duration: '15 min', equipment: 'Mat', desc: 'Release tight hips from sitting all day with a slow, controlled sequence.', video: WORKOUT_VIDEO.stretchB, calories: 50, timeline: [
      { time: 0, move: '90/90 Hip Switches', cue: 'Keep both sit bones grounded as you rotate the knees side to side.' },
      { time: 240, move: 'Pigeon Pose Hold', cue: 'Square the hips forward and breathe into the stretch for 60 seconds per side.' },
      { time: 540, move: 'Deep Lunge with Rotation', cue: 'Sink the back knee low and reach the opposite arm toward the ceiling.' },
      { time: 780, move: 'Seated Butterfly Fold', cue: 'Let gravity draw the chest forward — don’t force the knees down.' }
    ]},
    { photo: '1517838277536-f5f99be501cd', title: 'Foundational Strength Primer', duration: '20 min', equipment: 'Bodyweight', desc: 'Build baseline strength in the core, glutes, and shoulders before loading weight.', video: WORKOUT_VIDEO.squats, calories: 110, timeline: [
      { time: 0, move: 'Glute Bridge x15', cue: 'Squeeze the glutes hard at the top and avoid arching the lower back.' },
      { time: 300, move: 'Bird Dog x10/side', cue: 'Keep the hips level and extend the opposite arm and leg without rotating.' },
      { time: 660, move: 'Wall Sit Hold', cue: 'Knees at 90°, back flat against the wall, breathe steadily.' },
      { time: 1020, move: 'Incline Push-Up x12', cue: 'Hands on an elevated surface, lower the chest with elbows at 45°.' }
    ]}
  ]},
  { title: 'Full-Body Burn', desc: 'High-output circuits that torch calories and work every major muscle group in one session.', cards: [
    { photo: '1541534741688-6078c6bfb5c5', title: '20-Minute Metabolic Circuit', duration: '20 min', equipment: 'Bodyweight', desc: 'Non-stop compound moves designed to keep your heart rate elevated.', video: WORKOUT_VIDEO.jumpingJacks, calories: 220, timeline: [
      { time: 0, move: 'Jumping Jacks x40', cue: 'Land soft on the balls of the feet and keep a steady rhythm.' },
      { time: 300, move: 'Mountain Climbers x30', cue: 'Drive the knees to the chest fast without letting the hips pike up.' },
      { time: 660, move: 'Burpees x12', cue: 'Chest to floor, explode up into the jump, control the landing.' },
      { time: 1020, move: 'Plank Hold to Finish', cue: 'Brace the core and keep a straight line from head to heels.' }
    ]},
    { photo: '1518310383802-640c2de311b2', title: 'Total Body Tabata', duration: '16 min', equipment: 'Timer', desc: 'Eight rounds of all-out effort with short recovery windows.', video: WORKOUT_VIDEO.pushups, calories: 190, timeline: [
      { time: 0, move: 'Round 1: Push-Ups', cue: '20s max effort, 10s rest — full range of motion on every rep.' },
      { time: 240, move: 'Round 3: Squat Jumps', cue: 'Land soft and immediately load into the next rep.' },
      { time: 540, move: 'Round 5: Plank Shoulder Taps', cue: 'Keep the hips still and minimize side-to-side rock.' },
      { time: 840, move: 'Round 8: Sprint in Place', cue: 'Max cadence for the final round — empty the tank.' }
    ]},
    { photo: '1599447421416-3414500d18a5', title: 'Full-Body Finisher', duration: '10 min', equipment: 'Bodyweight', desc: 'A short, brutal finisher to close out any workout.', video: WORKOUT_VIDEO.squats, calories: 95, timeline: [
      { time: 0, move: 'Squat to Press x15', cue: 'Drive through the heels and punch the arms overhead at the top.' },
      { time: 180, move: 'Plank Jacks x20', cue: 'Keep the shoulders stacked over the wrists as the feet jump wide.' },
      { time: 360, move: 'High Knees x30s', cue: 'Pump the arms and knees together at a fast, controlled pace.' },
      { time: 480, move: 'Cool-Down Breathing', cue: 'Slow the heart rate with 5 deep breaths before you stop.' }
    ]}
  ]},
  { title: 'Dumbbell Only', desc: 'Everything you need from just a single pair of dumbbells — perfect for home or travel.', cards: [
    { photo: '1638536532686-d610adfc8e5c', title: 'Classic Dumbbell Strength', duration: '30 min', equipment: 'Dumbbells', weightLbs: 20, desc: 'A balanced push-pull session covering every major muscle group.', video: WORKOUT_VIDEO.squats, calories: 240, timeline: [
      { time: 0, move: 'Goblet Squat x12', cue: 'Hold the dumbbell at chest height and sit back into the heels.' },
      { time: 480, move: 'Bent-Over Row x12/side', cue: 'Flat back, pull the elbow past the ribs, squeeze the shoulder blade.' },
      { time: 960, move: 'Dumbbell Shoulder Press x10', cue: 'Press straight overhead and avoid flaring the ribs.' },
      { time: 1560, move: 'Romanian Deadlift x12', cue: 'Soft knees, hinge the hips back, keep the dumbbells close to the shins.' }
    ]}
  ]},
  { title: 'Recover Well', desc: 'Slow it down with recovery-focused sessions that reduce soreness and improve mobility.', cards: [
    { photo: '1600880292203-757bb62b4baf', title: 'Foam Roll Reset', duration: '10 min', equipment: 'Foam Roller', desc: 'Release fascia and speed up recovery after a heavy training week.', video: WORKOUT_VIDEO.stretchB, calories: 35, timeline: [
      { time: 0, move: 'Quad Roll', cue: 'Slow, controlled passes — pause on tender spots for 20-30 seconds.' },
      { time: 180, move: 'IT Band Roll', cue: 'Support bodyweight with the opposite leg to control the pressure.' },
      { time: 360, move: 'Upper Back Roll', cue: 'Support the head with clasped hands, roll from mid-back to shoulders.' },
      { time: 480, move: 'Calf Roll', cue: 'Cross one leg over the other to add pressure, roll heel to knee.' }
    ]},
    { photo: '1552196563-55cd4e45efb3', title: 'Gentle Cooldown Stretch', duration: '12 min', equipment: 'Mat', desc: 'Bring your heart rate down and lengthen worked muscles.', video: WORKOUT_VIDEO.stretchA, calories: 40, timeline: [
      { time: 0, move: 'Standing Forward Fold', cue: 'Bend the knees generously and let the spine round completely.' },
      { time: 240, move: 'Seated Spinal Twist', cue: 'Rotate from the ribcage, keep both sit bones grounded.' },
      { time: 480, move: "Child's Pose Hold", cue: 'Reach the arms long and breathe into the lower back for 60 seconds.' },
      { time: 600, move: 'Supine Hamstring Stretch', cue: 'Use a strap or your hands behind the thigh, keep the leg soft.' }
    ]},
    { photo: '1506126613408-eca07ce68773', title: 'Active Recovery Walk & Stretch', duration: '25 min', equipment: 'No Equipment', desc: 'Low-intensity movement to flush out lactic acid on rest days.', video: WORKOUT_VIDEO.mat, calories: 120, timeline: [
      { time: 0, move: 'Easy Pace Walk', cue: 'Keep the effort conversational — this is recovery, not cardio.' },
      { time: 600, move: 'Walking Lunges x10/side', cue: 'Control the descent and avoid letting the front knee cave in.' },
      { time: 1200, move: 'Standing Calf Stretch', cue: 'Keep the back heel grounded and lean into the wall.' },
      { time: 1440, move: 'Deep Breathing Cooldown', cue: 'Five slow breaths, in through the nose, out through the mouth.' }
    ]}
  ]},
  { title: 'Everyday Stretches', desc: 'Short, no-equipment stretch breaks you can slot in anywhere — desk, gym floor, or bedroom.', cards: [
    { photo: '1544367567-0f2fcb009e0b', title: '5-Minute Desk Break Stretch', duration: '5 min', equipment: 'No Equipment', desc: 'Undo hours of sitting with a quick standing stretch sequence.', video: WORKOUT_VIDEO.stretchA, calories: 18, timeline: [
      { time: 0, move: 'Seated Spinal Twist', cue: 'Rotate from your seat and keep the hips square to the chair.' },
      { time: 60, move: 'Neck Side Stretch', cue: 'Ear to shoulder, gentle pull with the hand — no forcing.' },
      { time: 180, move: 'Doorway Chest Stretch', cue: 'Elbow at shoulder height, lean forward until you feel the stretch.' },
      { time: 240, move: 'Standing Forward Reach', cue: 'Interlace the fingers, reach forward and round the upper back.' }
    ]},
    { photo: '1571019613454-1cb2f99b2d8b', title: 'Full-Body Flexibility Routine', duration: '10 min', equipment: 'Mat', desc: 'A head-to-toe stretch to keep everyday stiffness away.', video: WORKOUT_VIDEO.stretchB, calories: 35, timeline: [
      { time: 0, move: 'Cat-Cow Flow', cue: 'Move with the breath — one full cycle per inhale/exhale.' },
      { time: 180, move: 'Downward Dog Hold', cue: 'Press the floor away and pedal the heels to loosen the calves.' },
      { time: 360, move: 'Lizard Lunge Stretch', cue: 'Lower the back knee for a lighter variation if needed.' },
      { time: 480, move: 'Supine Twist', cue: 'Let both knees fall to one side, keep the shoulders flat on the mat.' }
    ]}
  ]},
  { title: 'HIIT Cardio Blasts', desc: 'Short, intense interval workouts built to spike your heart rate and burn calories fast.', cards: [
    { photo: '1534438327276-14e5300c3a48', title: '10-Minute HIIT Sprint', duration: '10 min', equipment: 'Bodyweight', desc: 'Maximum intensity intervals for a fast, effective cardio hit.', video: WORKOUT_VIDEO.jumpingJacks, calories: 130, timeline: [
      { time: 0, move: 'Jumping Jacks (40s)', cue: 'Max pace, land softly, keep the arms fully extended overhead.' },
      { time: 120, move: 'Squat Jumps (40s)', cue: 'Explode up and absorb the landing softly through the knees.' },
      { time: 300, move: 'Mountain Climbers (40s)', cue: 'Fast feet, keep the hips low and the core braced.' },
      { time: 480, move: 'Sprint in Place', cue: 'Final all-out push — empty the tank before the cooldown.' }
    ]},
    { photo: '1599447421416-3414500d18a5', title: 'Cardio Blast Ladder', duration: '18 min', equipment: 'Bodyweight', desc: 'Climbing work-to-rest ratios that ramp up the challenge each round.', video: WORKOUT_VIDEO.pushups, calories: 215, timeline: [
      { time: 0, move: 'Round 1: 20s Work / 40s Rest', cue: 'Ease in — focus on clean form over speed.' },
      { time: 360, move: 'Round 4: 30s Work / 30s Rest', cue: 'Ratio tightens — hold pace through the full interval.' },
      { time: 720, move: 'Round 7: 40s Work / 20s Rest', cue: 'Push through the fatigue, keep the breathing rhythmic.' },
      { time: 960, move: 'Round 10: 50s Work / 10s Rest', cue: 'Final ladder rung — leave nothing in reserve.' }
    ]}
  ]},
  { title: 'Full Body Kettlebell', desc: 'Swing, press, and carry your way through dynamic kettlebell flows for strength and conditioning.', cards: [
    { photo: '1583454110551-21f2fa2afe61', title: 'Kettlebell Swing & Carry Flow', duration: '25 min', equipment: 'Kettlebell', desc: 'Build posterior-chain power and grip strength in one flowing circuit.', video: WORKOUT_VIDEO.squats, calories: 260, timeline: [
      { time: 0, move: 'Two-Hand Kettlebell Swing x15', cue: 'Hinge from the hips and snap forward with the glutes, not the arms.' },
      { time: 480, move: 'Goblet Carry (40m)', cue: 'Hold tight to the chest and brace the core with every step.' },
      { time: 960, move: 'Single-Arm Swing x10/side', cue: 'Let the bell float weightless at the top, control the descent.' },
      { time: 1320, move: "Farmer's Carry (40m)", cue: 'Shoulders back, walk tall, grip the handle hard.' }
    ]}
  ]},
  { title: 'Yoga for Everyone', desc: 'Approachable yoga sequences that build flexibility, balance, and calm — no experience required.', cards: [
    { photo: '1600880292203-757bb62b4baf', title: 'Beginner Flow', duration: '15 min', equipment: 'Mat', desc: 'A gentle introduction to foundational yoga poses and breathing.', video: WORKOUT_VIDEO.yoga, calories: 55, timeline: [
      { time: 0, move: 'Mountain Pose Breathing', cue: 'Root through all four corners of the feet and lengthen the spine.' },
      { time: 240, move: 'Sun Salutation A', cue: 'Move one breath per pose, keep the flow unhurried.' },
      { time: 540, move: 'Warrior II Hold', cue: 'Front knee tracks over the ankle, arms reach actively long.' },
      { time: 780, move: 'Seated Meditation', cue: 'Close the eyes and settle the breath before you finish.' }
    ]},
    { photo: '1506126613408-eca07ce68773', title: 'Balance & Breath Sequence', duration: '20 min', equipment: 'Mat', desc: 'Steady, flowing poses that build core stability and focus.', video: WORKOUT_VIDEO.yoga, calories: 70, timeline: [
      { time: 0, move: 'Tree Pose Hold', cue: 'Press the foot into the standing leg and fix your gaze on one point.' },
      { time: 360, move: 'Half Moon Pose', cue: 'Stack the hips, extend through both the fingertips and the lifted heel.' },
      { time: 780, move: 'Crow Pose Prep', cue: 'Shift the weight forward slowly, knees braced on the triceps.' },
      { time: 1080, move: 'Legs-Up-The-Wall', cue: 'Relax completely and let gravity drain the tension from the legs.' }
    ]}
  ]},
  { title: 'Blog Favourites', desc: 'Reader-favorite routines pulled straight from our most-loved training articles.', cards: [
    { photo: '1534438327276-14e5300c3a48', title: 'The 15-Minute Habit Builder', duration: '15 min', equipment: 'Bodyweight', desc: 'The routine readers say finally made working out stick.', video: WORKOUT_VIDEO.mat, calories: 95, timeline: [
      { time: 0, move: 'Bodyweight Squat x15', cue: 'Sit back like into a chair, knees tracking over the toes.' },
      { time: 240, move: 'Push-Up x10', cue: 'Full range of motion, chest to floor, elbows at 45°.' },
      { time: 540, move: 'Plank Hold (30s)', cue: 'Straight line from head to heels, brace the core.' },
      { time: 720, move: 'Glute Bridge x15', cue: 'Squeeze at the top and avoid overarching the back.' }
    ]},
    { photo: '1541534741688-6078c6bfb5c5', title: 'Strength Basics Everyone Loves', duration: '22 min', equipment: 'Dumbbells', weightLbs: 15, desc: 'Our most-shared beginner strength routine, still a community favorite.', video: WORKOUT_VIDEO.squats, calories: 180, timeline: [
      { time: 0, move: 'Dumbbell Squat x12', cue: 'Dumbbells at your sides, chest tall through the full squat.' },
      { time: 420, move: 'Dumbbell Row x12/side', cue: 'Flat back, pull the elbow tight to the ribs.' },
      { time: 840, move: 'Dumbbell Bicep Curl x12', cue: 'Elbows pinned to the sides — no swinging the weight.' },
      { time: 1140, move: 'Overhead Triceps Extension x12', cue: 'One dumbbell, elbows close to the ears, control the descent.' }
    ]}
  ]},
  { title: 'Simple Self Care', desc: 'Gentle, restorative sessions that put wellbeing first — perfect for low-energy days.', cards: [
    { photo: '1545205597-3d9d02c29597', title: 'Slow Morning Reset', duration: '10 min', equipment: 'Mat', desc: 'Ease into the day with gentle movement and mindful breathing.', video: WORKOUT_VIDEO.stretchB, calories: 30, timeline: [
      { time: 0, move: 'Lying Full-Body Stretch', cue: 'Reach the fingertips and toes in opposite directions.' },
      { time: 180, move: 'Gentle Spinal Twist', cue: 'Let both knees fall to one side, breathe into the ribs.' },
      { time: 360, move: 'Seated Neck Rolls', cue: 'Slow, wide circles — reverse direction halfway through.' },
      { time: 480, move: 'Gratitude Breathing', cue: 'Three slow breaths, setting an intention for the day.' }
    ]},
    { photo: '1515377905703-c4788e51af15', title: 'Evening Wind-Down', duration: '12 min', equipment: 'No Equipment', desc: 'A calming sequence to release tension before bed.', video: WORKOUT_VIDEO.stretchA, calories: 32, timeline: [
      { time: 0, move: 'Standing Forward Fold', cue: 'Let the head hang heavy, keep the knees soft.' },
      { time: 240, move: 'Legs-Up-The-Wall', cue: 'Rest the arms open and breathe low into the belly.' },
      { time: 480, move: "Child's Pose Hold", cue: 'Sink the hips to the heels, arms relaxed long overhead.' },
      { time: 600, move: 'Body Scan Breathing', cue: 'Move attention slowly head to toe, releasing tension.' }
    ]}
  ]},
  { title: 'Fitness at Home', desc: 'No gym, no problem — full workouts built entirely around your living room.', cards: [
    { photo: '1584735935682-2f2b69dff9d2', title: 'Living Room Full-Body Workout', duration: '20 min', equipment: 'Bodyweight', desc: 'Everything you need for a complete session without leaving home.', video: WORKOUT_VIDEO.pushups, calories: 175, timeline: [
      { time: 0, move: 'Bodyweight Squat x15', cue: 'Use a chair behind you for a depth reference if needed.' },
      { time: 360, move: 'Push-Up x12', cue: 'Modify on the knees if needed, keep the hips in line.' },
      { time: 720, move: 'Reverse Lunge x10/side', cue: 'Step back softly, keep the front shin vertical.' },
      { time: 1020, move: 'Plank Hold (45s)', cue: 'Brace the core and keep breathing steady throughout.' }
    ]}
  ]}
];

function renderWorkoutExplore() {
  if (wrExploreListEl.childElementCount > 0) return;
  wrExploreListEl.innerHTML = WORKOUT_CATEGORIES.map((cat, catIdx) => `
    <section class="wr-category">
      <h2 class="wr-category-title">${escapeHtml(cat.title)}</h2>
      <p class="wr-category-desc">${escapeHtml(cat.desc)}</p>
      <div class="wr-carousel">
        ${cat.cards.map((card, cardIdx) => `
          <article class="wr-card" data-cat-idx="${catIdx}" data-card-idx="${cardIdx}" tabindex="0" role="button" aria-label="Open ${escapeHtml(card.title)} details">
            <img class="wr-card-thumb" src="https://images.unsplash.com/photo-${card.photo}?auto=format&fit=crop&w=400&q=80" alt="${escapeHtml(card.title)}" loading="lazy" />
            <span class="wr-card-meta">⏱ ${escapeHtml(card.duration)} | ${escapeHtml(card.equipment)}</span>
            <h3 class="wr-card-title">${escapeHtml(card.title)}</h3>
            <p class="wr-card-desc">${escapeHtml(card.desc)}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
}

// ---------- Workout Video Details Modal (sliding sheet) ----------
const workoutModalEl = document.getElementById('workout-detail-modal');
const workoutModalBackdropEl = document.getElementById('workoutModalBackdrop');
const workoutModalSheetEl = document.getElementById('workoutModalSheet');
const workoutModalVideoEl = document.getElementById('workoutModalVideo');
const workoutModalCloseBtn = document.getElementById('workoutModalCloseBtn');
const workoutModalTitleEl = document.getElementById('workoutModalTitle');
const workoutModalDurationEl = document.getElementById('workoutModalDuration');
const workoutModalEquipmentEl = document.getElementById('workoutModalEquipment');
const workoutModalCaloriesEl = document.getElementById('workoutModalCalories');
const workoutModalWeightEl = document.getElementById('workoutModalWeight');
const workoutModalTimelineEl = document.getElementById('workoutModalTimeline');

// Tracks whichever card is currently open so the Unit System toggle can
// re-render the weight badge in place without having to reopen the sheet —
// same pattern as currentRecipeModalRecipe/renderRecipeModalUnits() above.
let currentWorkoutModalCard = null;

function renderWorkoutModalUnits() {
  if (!currentWorkoutModalCard || !currentWorkoutModalCard.weightLbs) return;
  const lbs = currentWorkoutModalCard.weightLbs;
  workoutModalWeightEl.textContent = userUnitPreference === 'metric'
    ? `⚖ ${Math.round(lbsToKg(lbs))} kg`
    : `⚖ ${lbs} lbs`;
}

function openWorkoutModal(card) {
  currentWorkoutModalCard = card;
  workoutModalVideoEl.src = card.video || '';
  workoutModalTitleEl.textContent = card.title;
  workoutModalDurationEl.textContent = `⏱ ${card.duration}`;
  workoutModalEquipmentEl.textContent = `🏋 ${card.equipment}`;
  workoutModalCaloriesEl.textContent = `🔥 ${card.calories} kcal`;
  workoutModalWeightEl.classList.toggle('hidden', !card.weightLbs);
  renderWorkoutModalUnits();
  workoutModalTimelineEl.innerHTML = (card.timeline || []).map((step) => `
    <li>
      <span class="workout-modal-timeline-time">${step.time}s</span>
      <span class="workout-modal-timeline-copy">
        <span class="workout-modal-timeline-move">${escapeHtml(step.move)}</span>
        <span class="workout-modal-timeline-cue">${escapeHtml(step.cue)}</span>
      </span>
    </li>
  `).join('');
  workoutModalEl.classList.remove('hidden');
  workoutModalEl.setAttribute('aria-hidden', 'false');
  workoutModalVideoEl.play().catch(() => {
    // Autoplay can be blocked before any user gesture on some browsers —
    // the video still shows its poster frame and the sheet still opens fine.
  });
  // Force a reflow before adding .open so the translate3d transition plays
  // from its 100% starting position instead of jumping straight to 0.
  void workoutModalSheetEl.offsetHeight;
  requestAnimationFrame(() => workoutModalEl.classList.add('open'));
}

function closeWorkoutModal() {
  if (workoutModalEl.classList.contains('hidden')) return;
  workoutModalEl.classList.remove('open');
  workoutModalEl.setAttribute('aria-hidden', 'true');
  const onEnd = (e) => {
    if (e.target !== workoutModalSheetEl || e.propertyName !== 'transform') return;
    workoutModalSheetEl.removeEventListener('transitionend', onEnd);
    workoutModalEl.classList.add('hidden');
    workoutModalVideoEl.pause();
    workoutModalVideoEl.removeAttribute('src');
    workoutModalVideoEl.load();
    currentWorkoutModalCard = null;
  };
  workoutModalSheetEl.addEventListener('transitionend', onEnd);
}

wrExploreListEl.addEventListener('click', (e) => {
  const card = e.target.closest('.wr-card');
  if (!card) return;
  const cat = WORKOUT_CATEGORIES[Number(card.dataset.catIdx)];
  const item = cat && cat.cards[Number(card.dataset.cardIdx)];
  if (item) openWorkoutModal(item);
});
wrExploreListEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.wr-card');
  if (!card) return;
  e.preventDefault();
  const cat = WORKOUT_CATEGORIES[Number(card.dataset.catIdx)];
  const item = cat && cat.cards[Number(card.dataset.cardIdx)];
  if (item) openWorkoutModal(item);
});
workoutModalCloseBtn.addEventListener('click', closeWorkoutModal);
workoutModalBackdropEl.addEventListener('click', closeWorkoutModal);

// Panel swap runs inside requestAnimationFrame so the tab underline and the
// card-list toggle land in the same paint — no stutter from two separate reflows.
function switchWorkoutRoutinesTab(key) {
  requestAnimationFrame(() => {
    wrTabsEl.querySelectorAll('.log-subtab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    wrExplorePanel.classList.toggle('hidden', key !== 'explore');
    wrMyRoutinesPanel.classList.toggle('hidden', key !== 'my-routines');
  });
}
wrTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.log-subtab-btn');
  if (!btn) return;
  switchWorkoutRoutinesTab(btn.dataset.tab);
});

function openWorkoutRoutinesView() {
  renderWorkoutExplore();
  switchWorkoutRoutinesTab('explore');
  openSubView(workoutRoutinesView);
}
wrBackBtn.addEventListener('click', () => closeSubView(workoutRoutinesView));
wrTrackRepsBtn.addEventListener('click', () => {
  closeSubView(workoutRoutinesView);
  openWorkoutsView();
});

// ---------- Weight & Measurements ----------
const weightMeasurementsView = document.getElementById('weightMeasurementsView');
const weightMeasurementsBackBtn = document.getElementById('weightMeasurementsBackBtn');
const wmRangeRowEl = document.getElementById('wmRangeRow');
const wmFilterRowEl = document.getElementById('wmFilterRow');
const wmChartAxisEl = document.getElementById('wmChartAxis');
const wmChartSvgEl = document.getElementById('wmChartSvg');
const wmEmptyStateEl = document.getElementById('wmEmptyState');
const wmHistoryListEl = document.getElementById('wmHistoryList');
const wmEditBodyMeasurementsBtn = document.getElementById('wmEditBodyMeasurementsBtn');

const WM_RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
let wmRange = '3M';
let wmFilter = 'weight';

function renderWeightMeasurementsChart() {
  wmChartAxisEl.innerHTML = '';
  wmChartSvgEl.innerHTML = '';
  wmHistoryListEl.innerHTML = '';

  if (wmFilter !== 'weight') {
    wmEmptyStateEl.classList.remove('hidden');
    wmChartSvgEl.classList.add('hidden');
    wmChartAxisEl.classList.add('hidden');
    return;
  }
  wmEmptyStateEl.classList.add('hidden');
  wmChartSvgEl.classList.remove('hidden');
  wmChartAxisEl.classList.remove('hidden');

  const cutoff = addDaysToDateStr(todayStr(), -WM_RANGE_DAYS[wmRange]);
  const inRange = state.weights.filter((w) => w.date >= cutoff).slice().sort((a, b) => a.date.localeCompare(b.date));

  for (const w of [...inRange].reverse()) {
    wmHistoryListEl.appendChild(buildWeightEntry(w));
  }
  if (wmHistoryListEl.children.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No weight logged in this range.';
    wmHistoryListEl.appendChild(empty);
  }

  if (inRange.length === 0) return;

  const unit = getWeightUnit();
  const values = inRange.map((w) => (unit === 'lbs' ? kgToLbs(w.weight) : w.weight));
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const ceiling = maxVal === minVal ? maxVal + 1 : maxVal;
  const floor = maxVal === minVal ? Math.max(0, minVal - 1) : minVal;

  for (let i = 4; i >= 0; i--) {
    const span = document.createElement('span');
    span.textContent = Math.round(floor + ((ceiling - floor) / 4) * i);
    wmChartAxisEl.appendChild(span);
  }

  const width = 300;
  const height = 140;
  const padY = 6;
  const plotHeight = height - padY * 2;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? i * stepX : width / 2;
      const y = padY + plotHeight - ((v - floor) / (ceiling - floor)) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const gridLines = [0, 1, 2, 3, 4]
    .map((i) => {
      const y = (padY + (plotHeight / 4) * i).toFixed(1);
      return `<line class="macro-history-grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}" />`;
    })
    .join('');
  wmChartSvgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  wmChartSvgEl.innerHTML = `${gridLines}<polyline class="macro-history-line cyan" points="${points}" />`;
}

wmRangeRowEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  wmRange = btn.dataset.range;
  wmRangeRowEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderWeightMeasurementsChart();
});
wmFilterRowEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  wmFilter = btn.dataset.filter;
  wmFilterRowEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderWeightMeasurementsChart();
});
wmEditBodyMeasurementsBtn.addEventListener('click', () => openWeightMeasurementsModal());

function openWeightMeasurementsView() {
  renderWeightMeasurementsChart();
  openSubView(weightMeasurementsView);
}
weightMeasurementsBackBtn.addEventListener('click', () => closeSubView(weightMeasurementsView));

// ---------- Intermittent Fasting ----------
const fastingView = document.getElementById('fastingView');
const fastingBackBtn = document.getElementById('fastingBackBtn');
const fastingRingProgressEl = document.getElementById('fastingRingProgress');
const fastingCountdownValueEl = document.getElementById('fastingCountdownValue');
const fastingCountdownLabelEl = document.getElementById('fastingCountdownLabel');
const fastingStartBtn = document.getElementById('fastingStartBtn');
const fastingEndBtn = document.getElementById('fastingEndBtn');
const fastingProtocolListEl = document.getElementById('fastingProtocolList');
const fastingCustomHoursInput = document.getElementById('fastingCustomHoursInput');
let fastingSelectedProtocol = '16:8';
let fastingTickTimer = null;

function fastingGoalHoursFor(protocol) {
  if (protocol === '16:8') return 16;
  if (protocol === '18:6') return 18;
  if (protocol === '20:4') return 20;
  return Number(fastingCustomHoursInput.value) || 20;
}

function renderFastingState() {
  const session = state.fasting?.activeSession;
  fastingProtocolListEl.querySelectorAll('.more-menu-item').forEach((li) => {
    li.classList.toggle('active-protocol', li.dataset.protocol === (state.fasting?.protocol || fastingSelectedProtocol));
  });

  if (!session) {
    setRingProgress(fastingRingProgressEl, 0);
    fastingCountdownValueEl.textContent = '00:00:00';
    fastingCountdownLabelEl.textContent = 'Not fasting';
    fastingStartBtn.classList.remove('hidden');
    fastingEndBtn.classList.add('hidden');
    return;
  }

  fastingStartBtn.classList.add('hidden');
  fastingEndBtn.classList.remove('hidden');

  const startedAt = new Date(session.startedAt).getTime();
  const goalMs = session.goalHours * 3600000;
  const elapsedMs = Date.now() - startedAt;
  const remainingMs = Math.max(0, goalMs - elapsedMs);
  const pct = Math.min(1, elapsedMs / goalMs);
  setRingProgress(fastingRingProgressEl, pct);

  const h = String(Math.floor(remainingMs / 3600000)).padStart(2, '0');
  const m = String(Math.floor((remainingMs % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
  fastingCountdownValueEl.textContent = remainingMs > 0 ? `${h}:${m}:${s}` : 'Goal reached!';
  fastingCountdownLabelEl.textContent = `fasting (${session.goalHours}h goal)`;
}

async function loadFasting() {
  try {
    const res = await authFetch(`${API}/fasting`);
    if (!res.ok) throw new Error('Failed to load fasting state');
    state.fasting = await res.json();
    fastingSelectedProtocol = state.fasting.protocol;
    renderFastingState();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openFastingView() {
  loadFasting();
  clearInterval(fastingTickTimer);
  fastingTickTimer = setInterval(renderFastingState, 1000);
  openSubView(fastingView);
}
fastingBackBtn.addEventListener('click', () => {
  clearInterval(fastingTickTimer);
  closeSubView(fastingView);
});

fastingProtocolListEl.addEventListener('click', (e) => {
  const li = e.target.closest('.more-menu-item');
  if (!li || e.target === fastingCustomHoursInput) return;
  fastingSelectedProtocol = li.dataset.protocol;
  fastingProtocolListEl.querySelectorAll('.more-menu-item').forEach((el) => el.classList.toggle('active-protocol', el === li));
});

fastingStartBtn.addEventListener('click', async () => {
  const protocol = FASTING_PROTOCOLS_CLIENT.includes(fastingSelectedProtocol) ? fastingSelectedProtocol : 'custom';
  try {
    const res = await authFetch(`${API}/fasting/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol, goalHours: fastingGoalHoursFor(protocol) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start fast');
    state.fasting = data;
    renderFastingState();
    showToast('Fast started');
  } catch (err) {
    showToast(err.message, true);
  }
});
fastingEndBtn.addEventListener('click', async () => {
  try {
    const res = await authFetch(`${API}/fasting/end`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to end fast');
    state.fasting = data;
    renderFastingState();
    showToast('Fast ended');
  } catch (err) {
    showToast(err.message, true);
  }
});
const FASTING_PROTOCOLS_CLIENT = ['16:8', '18:6', '20:4'];

// ---------- Nutrition Analytics ----------
const nutritionAnalyticsView = document.getElementById('nutritionAnalyticsView');
const nutritionAnalyticsBackBtn = document.getElementById('nutritionAnalyticsBackBtn');
const naTabsEl = document.getElementById('naTabs');
const naCaloriesChartEl = document.getElementById('naCaloriesChart');
const naNutrientsListEl = document.getElementById('naNutrientsList');
const naMacroRingsEl = document.getElementById('naMacroRings');

initFlatTabs(
  naTabsEl,
  [...naTabsEl.parentElement.querySelectorAll('[data-tab-panel]')].map((el) => ({ key: el.dataset.tabPanel, el })),
  () => {}
);

async function openNutritionAnalyticsView() {
  openSubView(nutritionAnalyticsView);
  const history = await loadHistory({ days: 7 });
  if (!history) return;
  renderMetricBarChart(naCaloriesChartEl, history.days, 'calories', state.settings?.calorieGoal || 0);
  renderNutrientsListInto(naNutrientsListEl, history.averages);
  renderMacroRingsInto(naMacroRingsEl, history.averages);
}
nutritionAnalyticsBackBtn.addEventListener('click', () => closeSubView(nutritionAnalyticsView));

// ---------- Meals, Recipes & Foods ----------
const mrfView = document.getElementById('mrfView');
const mrfBackBtn = document.getElementById('mrfBackBtn');
const mrfTabsEl = document.getElementById('mrfTabs');
const mrfRecipesListEl = document.getElementById('mrfRecipesList');
const mrfMealsListEl = document.getElementById('mrfMealsList');
const mrfFoodsListEl = document.getElementById('mrfFoodsList');
const mrfCreateForm = document.getElementById('mrfCreateForm');
const mrfNameInput = document.getElementById('mrfNameInput');
const mrfCaloriesInput = document.getElementById('mrfCaloriesInput');
const mrfProteinInput = document.getElementById('mrfProteinInput');
const mrfCarbsInput = document.getElementById('mrfCarbsInput');
const mrfFatInput = document.getElementById('mrfFatInput');
const mrfCreateError = document.getElementById('mrfCreateError');
const mrfCancelBtn = document.getElementById('mrfCancelBtn');
const mrfSaveBtn = document.getElementById('mrfSaveBtn');
const mrfCreateBtn = document.getElementById('mrfCreateBtn');

const MRF_RESOURCE_BY_TAB = { recipes: 'saved-recipes', meals: 'saved-meals', foods: 'saved-foods' };
const MRF_STATE_KEY_BY_TAB = { recipes: 'savedRecipes', meals: 'savedMeals', foods: 'savedFoods' };
const MRF_LIST_EL_BY_TAB = { recipes: mrfRecipesListEl, meals: mrfMealsListEl, foods: mrfFoodsListEl };
let mrfActiveTab = 'recipes';

function buildSavedItemEntry(item, onDelete) {
  const li = document.createElement('li');
  li.className = 'weight-entry';
  li.innerHTML = `
    <span class="weight-date">${escapeHtml(item.name)}</span>
    <span class="weight-value">${item.calories} cal · P${item.protein} C${item.carbs} F${item.fat}</span>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.setAttribute('aria-label', 'Delete');
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', onDelete);
  li.appendChild(deleteBtn);
  return li;
}

async function loadMrfTab(tab) {
  try {
    const res = await authFetch(`${API}/${MRF_RESOURCE_BY_TAB[tab]}`);
    if (!res.ok) throw new Error('Failed to load list');
    state[MRF_STATE_KEY_BY_TAB[tab]] = await res.json();
    renderMrfTab(tab);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderMrfTab(tab) {
  const listEl = MRF_LIST_EL_BY_TAB[tab];
  const items = state[MRF_STATE_KEY_BY_TAB[tab]];
  listEl.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = `No saved ${tab} yet — tap "Create New Item" to add one.`;
    listEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    listEl.appendChild(
      buildSavedItemEntry(item, async () => {
        await authFetch(`${API}/${MRF_RESOURCE_BY_TAB[tab]}/${item.id}`, { method: 'DELETE' });
        await loadMrfTab(tab);
      })
    );
  }
}

initFlatTabs(
  mrfTabsEl,
  [...mrfTabsEl.parentElement.querySelectorAll('[data-tab-panel]')].map((el) => ({ key: el.dataset.tabPanel, el })),
  (key) => {
    mrfActiveTab = key;
    loadMrfTab(key);
  }
);

function openMrfView() {
  mrfCreateForm.classList.add('hidden');
  loadMrfTab(mrfActiveTab);
  openSubView(mrfView);
}
mrfBackBtn.addEventListener('click', () => closeSubView(mrfView));
mrfCreateBtn.addEventListener('click', () => {
  mrfCreateError.textContent = '';
  mrfNameInput.value = '';
  mrfCaloriesInput.value = '';
  mrfProteinInput.value = '';
  mrfCarbsInput.value = '';
  mrfFatInput.value = '';
  mrfCreateForm.classList.remove('hidden');
  mrfCreateForm.scrollIntoView({ behavior: 'smooth' });
});
mrfCancelBtn.addEventListener('click', () => mrfCreateForm.classList.add('hidden'));
mrfSaveBtn.addEventListener('click', async () => {
  mrfCreateError.textContent = '';
  const name = mrfNameInput.value.trim();
  const calories = Number(mrfCaloriesInput.value);
  const protein = Number(mrfProteinInput.value);
  const carbs = Number(mrfCarbsInput.value);
  const fat = Number(mrfFatInput.value);
  if (!name) { mrfCreateError.textContent = 'Enter a name.'; return; }
  if ([calories, protein, carbs, fat].some((n) => Number.isNaN(n) || n < 0)) {
    mrfCreateError.textContent = 'Enter valid non-negative macro values.';
    return;
  }
  try {
    const res = await authFetch(`${API}/${MRF_RESOURCE_BY_TAB[mrfActiveTab]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, calories, protein, carbs, fat })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save item');
    mrfCreateForm.classList.add('hidden');
    await loadMrfTab(mrfActiveTab);
    showToast('Saved');
  } catch (err) {
    mrfCreateError.textContent = err.message;
  }
});

// ---------- Steps Hub ----------
const stepsHubView = document.getElementById('stepsHubView');
const stepsHubBackBtn = document.getElementById('stepsHubBackBtn');
const stepsHubRingProgressEl = document.getElementById('stepsHubRingProgress');
const stepsHubValueEl = document.getElementById('stepsHubValue');
const stepsHubGoalLabelEl = document.getElementById('stepsHubGoalLabel');
const stepsHubSyncListEl = document.getElementById('stepsHubSyncList');
const stepsHubLogInput = document.getElementById('stepsHubLogInput');
const stepsHubLogBtn = document.getElementById('stepsHubLogBtn');
const stepsHubLogError = document.getElementById('stepsHubLogError');
const stepsHubWeeklyChartEl = document.getElementById('stepsHubWeeklyChart');
const STEPS_HUB_DAILY_GOAL = 10000;

async function loadDevices() {
  try {
    const res = await authFetch(`${API}/devices`);
    if (!res.ok) throw new Error('Failed to load devices');
    state.devices = await res.json();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderStepsHubSync() {
  stepsHubSyncListEl.querySelectorAll('[data-toggle]').forEach((btn) => {
    const on = Boolean(state.devices?.[btn.dataset.toggle]);
    btn.setAttribute('aria-checked', String(on));
  });
}

stepsHubSyncListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const key = btn.dataset.toggle;
  const next = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', String(next));
  try {
    const res = await authFetch(`${API}/devices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update sync setting');
    state.devices = data;
  } catch (err) {
    btn.setAttribute('aria-checked', String(!next));
    showToast(err.message, true);
  }
});

async function openStepsHubView() {
  stepsHubLogError.textContent = '';
  await Promise.all([loadSteps(true), loadDevices()]);
  const today = state.steps.find((s) => s.date === todayStr());
  const steps = today ? today.steps : 0;
  stepsHubValueEl.textContent = steps.toLocaleString();
  stepsHubGoalLabelEl.textContent = `of ${STEPS_HUB_DAILY_GOAL.toLocaleString()} steps`;
  setRingProgress(stepsHubRingProgressEl, steps / STEPS_HUB_DAILY_GOAL);
  renderStepsHubSync();
  const last7 = state.steps.slice(0, 7).slice().sort((a, b) => a.date.localeCompare(b.date));
  renderMetricBarChart(stepsHubWeeklyChartEl, last7, 'steps', STEPS_HUB_DAILY_GOAL);
  openSubView(stepsHubView);
}
stepsHubBackBtn.addEventListener('click', () => closeSubView(stepsHubView));

async function handleStepsHubLogSubmit() {
  stepsHubLogError.textContent = '';
  const entered = Number(stepsHubLogInput.value);
  if (!Number.isInteger(entered) || entered < 0) {
    stepsHubLogError.textContent = 'Enter a valid step count';
    return;
  }
  try {
    const res = await authFetch(`${API}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, steps: entered })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log steps');
    stepsHubLogInput.value = '';
    await loadSteps(true);
    const today = state.steps.find((s) => s.date === todayStr());
    const steps = today ? today.steps : 0;
    stepsHubValueEl.textContent = steps.toLocaleString();
    setRingProgress(stepsHubRingProgressEl, steps / STEPS_HUB_DAILY_GOAL);
    const last7 = state.steps.slice(0, 7).slice().sort((a, b) => a.date.localeCompare(b.date));
    renderMetricBarChart(stepsHubWeeklyChartEl, last7, 'steps', STEPS_HUB_DAILY_GOAL);
    showToast('Steps logged');
  } catch (err) {
    stepsHubLogError.textContent = err.message;
  }
}
stepsHubLogBtn.addEventListener('click', handleStepsHubLogSubmit);
stepsHubLogInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleStepsHubLogSubmit();
});

// ---------- Sleep Tracking ----------
const sleepTrackingView = document.getElementById('sleepTrackingView');
const sleepTrackingBackBtn = document.getElementById('sleepTrackingBackBtn');
const sleepWeeklyChartEl = document.getElementById('sleepWeeklyChart');
const sleepAvgDurationValueEl = document.getElementById('sleepAvgDurationValue');
const sleepDeepValueEl = document.getElementById('sleepTrackingDeepValue');
const sleepConsistencyValueEl = document.getElementById('sleepConsistencyValue');

async function openSleepTrackingView() {
  await loadSleep();
  const last7 = state.sleep.slice(0, 7).slice().sort((a, b) => a.date.localeCompare(b.date));
  renderMetricBarChart(sleepWeeklyChartEl, last7, 'totalHours', 0);

  if (last7.length === 0) {
    sleepAvgDurationValueEl.textContent = '0h';
    sleepDeepValueEl.textContent = '0h';
    sleepConsistencyValueEl.textContent = '0%';
  } else {
    const avgTotal = last7.reduce((sum, s) => sum + s.totalHours, 0) / last7.length;
    const avgDeep = last7.reduce((sum, s) => sum + s.deepHours, 0) / last7.length;
    const mean = avgTotal;
    const variance = last7.reduce((sum, s) => sum + (s.totalHours - mean) ** 2, 0) / last7.length;
    const stdDev = Math.sqrt(variance);
    const consistency = mean > 0 ? Math.max(0, Math.round(100 - (stdDev / mean) * 100)) : 0;
    sleepAvgDurationValueEl.textContent = `${Math.round(avgTotal * 10) / 10}h`;
    sleepDeepValueEl.textContent = `${Math.round(avgDeep * 10) / 10}h`;
    sleepConsistencyValueEl.textContent = `${consistency}%`;
  }
  renderSleepReminders();
  openSubView(sleepTrackingView);
}
sleepTrackingBackBtn.addEventListener('click', () => closeSubView(sleepTrackingView));

// ---------- Sleep Reminders (Sleep Tracking -> Sleep Reminders card) ----------
const SLEEP_NOTIF_ENABLED_KEY = 'sleep_notifications_enabled';
const SLEEP_NOTIF_BEDTIME_KEY = 'sleep_notification_bedtime';
const SLEEP_NOTIF_LAST_FIRED_KEY = 'sleep_notification_last_fired';
const sleepNotifToggle = document.getElementById('sleepNotifToggle');
const sleepNotifBedtimeInput = document.getElementById('sleepNotifBedtimeInput');
const sleepReminderBanner = document.getElementById('sleepReminderBanner');

function isSleepNotificationsEnabled() {
  return localStorage.getItem(SLEEP_NOTIF_ENABLED_KEY) === 'true';
}

function renderSleepReminders() {
  sleepNotifToggle.setAttribute('aria-checked', String(isSleepNotificationsEnabled()));
  sleepNotifBedtimeInput.value = localStorage.getItem(SLEEP_NOTIF_BEDTIME_KEY) || '22:00';
}

sleepNotifToggle.addEventListener('click', async () => {
  const next = sleepNotifToggle.getAttribute('aria-checked') !== 'true';
  if (next && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  localStorage.setItem(SLEEP_NOTIF_ENABLED_KEY, String(next));
  sleepNotifToggle.setAttribute('aria-checked', String(next));
  showToast(next ? 'Sleep notifications enabled' : 'Sleep notifications disabled');
});

sleepNotifBedtimeInput.addEventListener('change', () => {
  localStorage.setItem(SLEEP_NOTIF_BEDTIME_KEY, sleepNotifBedtimeInput.value);
});

// Short synthesized chime (no external audio asset) for the in-app fallback
// banner when the real Notification permission is blocked.
function playSleepReminderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch {}
}

let sleepReminderBannerTimer = null;
function showSleepReminderBanner() {
  sleepReminderBanner.classList.add('show');
  playSleepReminderChime();
  clearTimeout(sleepReminderBannerTimer);
  sleepReminderBannerTimer = setTimeout(() => sleepReminderBanner.classList.remove('show'), 6000);
}
sleepReminderBanner.addEventListener('click', () => sleepReminderBanner.classList.remove('show'));

function fireSleepReminder() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Pure Macros', { body: '🌙 Time to wind down! Your scheduled bedtime is in 30 minutes...' });
  } else {
    showSleepReminderBanner();
  }
}

// Background check loop: every 30s, compares now to (bedtime - 30 minutes).
// A localStorage date stamp caps it to firing once per calendar day so it
// doesn't repeat on every tick while inside the reminder window.
setInterval(() => {
  if (!isSleepNotificationsEnabled()) return;
  const bedtime = localStorage.getItem(SLEEP_NOTIF_BEDTIME_KEY);
  if (!bedtime) return;
  const [bh, bm] = bedtime.split(':').map(Number);
  if (Number.isNaN(bh) || Number.isNaN(bm)) return;
  const today = todayStr();
  if (localStorage.getItem(SLEEP_NOTIF_LAST_FIRED_KEY) === today) return;
  const now = new Date();
  const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), bh, bm - 30);
  const msSinceReminder = now - reminderTime;
  if (msSinceReminder >= 0 && msSinceReminder < 5 * 60 * 1000) {
    fireSleepReminder();
    localStorage.setItem(SLEEP_NOTIF_LAST_FIRED_KEY, today);
  }
}, 30000);

// ---------- Reminders ----------
const remindersView = document.getElementById('remindersView');
const remindersBackBtn = document.getElementById('remindersBackBtn');
const remindersListEl = document.getElementById('remindersList');
const REMINDER_TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

async function loadReminders() {
  try {
    const res = await authFetch(`${API}/reminders`);
    if (!res.ok) throw new Error('Failed to load reminders');
    state.reminders = await res.json();
    renderReminders();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderReminders() {
  remindersListEl.innerHTML = '';
  for (const r of state.reminders) {
    const li = document.createElement('li');
    li.className = 'weight-entry';
    const options = REMINDER_TIME_OPTIONS.map((t) => `<option value="${t}"${t === r.time ? ' selected' : ''}>${t}</option>`).join('');
    li.innerHTML = `
      <span class="weight-date">${escapeHtml(r.label)}</span>
      <select class="reminder-time-select" data-reminder-time="${r.id}">${options}</select>
      <button type="button" class="theme-switch" data-reminder-toggle="${r.id}" role="switch" aria-checked="${r.enabled}"><span class="theme-switch-thumb"></span></button>
    `;
    remindersListEl.appendChild(li);
  }
}

remindersListEl.addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-reminder-toggle]');
  if (!toggle) return;
  const id = toggle.dataset.reminderToggle;
  const next = toggle.getAttribute('aria-checked') !== 'true';
  toggle.setAttribute('aria-checked', String(next));
  try {
    await authFetch(`${API}/reminders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next })
    });
  } catch {
    toggle.setAttribute('aria-checked', String(!next));
    showToast('Failed to update reminder', true);
  }
});
remindersListEl.addEventListener('change', async (e) => {
  const select = e.target.closest('[data-reminder-time]');
  if (!select) return;
  try {
    await authFetch(`${API}/reminders/${select.dataset.reminderTime}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: select.value })
    });
  } catch {
    showToast('Failed to update reminder time', true);
  }
});

function openRemindersView() {
  loadReminders();
  openSubView(remindersView);
}
remindersBackBtn.addEventListener('click', () => closeSubView(remindersView));

// ---------- Recipe Discovery Engine (25-recipe matrix) ----------
// Purely client-side catalog — id, name, calories/protein/carbs/fat/fiber,
// prep_time, ingredients, directions, category, and an Unsplash photo
// placeholder — rendered as horizontally scrolling category carousels
// (reusing the Workout Routines .wr-carousel/.wr-card pattern) with a
// "View More" grid per category and a shared detail sheet (#recipe-modal).
const RECIPE_DB = [
  // ---- High Protein ----
  {
    id: 'hp1', category: 'High Protein', name: 'Grilled Chicken & Quinoa Power Bowl',
    calories: 480, protein: 42, carbs: 38, fat: 14, fiber: 6, prep_time: 25,
    ingredients: ['6oz grilled chicken breast', '1 cup cooked quinoa', '1/2 cup black beans', '1/2 avocado, sliced', 'Cherry tomatoes', 'Lime-cilantro dressing'],
    directions: ['Season and grill the chicken breast until cooked through, then slice.', 'Fluff the cooked quinoa into a bowl.', 'Top with black beans, avocado, and cherry tomatoes.', 'Drizzle with lime-cilantro dressing and serve.'],
    photo: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'hp2', category: 'High Protein', name: 'Egg White Veggie Scramble',
    calories: 320, protein: 36, carbs: 14, fat: 10, fiber: 4, prep_time: 12,
    ingredients: ['1 cup egg whites', '2 whole eggs', 'Spinach', 'Bell peppers', 'Onion', 'Feta cheese'],
    directions: ['Whisk egg whites and whole eggs together.', 'Sauté spinach, bell peppers, and onion until soft.', 'Pour in eggs and scramble over medium heat.', 'Top with crumbled feta and serve hot.'],
    photo: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'hp3', category: 'High Protein', name: 'Baked Salmon with Asparagus',
    calories: 450, protein: 40, carbs: 12, fat: 26, fiber: 4, prep_time: 25,
    ingredients: ['6oz salmon fillet', '1 bunch asparagus', 'Olive oil', 'Lemon', 'Garlic', 'Salt & pepper'],
    directions: ['Preheat oven to 400°F (200°C).', 'Arrange salmon and asparagus on a sheet pan, drizzle with olive oil and garlic.', 'Bake for 15-18 minutes until salmon flakes easily.', 'Finish with fresh lemon juice before serving.'],
    photo: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'hp4', category: 'High Protein', name: 'Turkey Meatballs over Zoodles',
    calories: 410, protein: 38, carbs: 16, fat: 20, fiber: 5, prep_time: 30,
    ingredients: ['1 lb ground turkey', '1 egg', 'Breadcrumbs', 'Marinara sauce', '2 zucchini, spiralized', 'Parmesan'],
    directions: ['Mix ground turkey, egg, and breadcrumbs; form into meatballs.', 'Bake or pan-sear meatballs until cooked through.', 'Simmer meatballs in marinara sauce.', 'Serve over spiralized zucchini noodles, topped with Parmesan.'],
    photo: 'https://images.unsplash.com/photo-1607532941433-304659e8198a?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'hp5', category: 'High Protein', name: 'Greek Yogurt Protein Parfait',
    calories: 340, protein: 32, carbs: 30, fat: 9, fiber: 5, prep_time: 8,
    ingredients: ['1.5 cups Greek yogurt', 'Mixed berries', 'Granola', 'Honey', 'Chia seeds'],
    directions: ['Layer Greek yogurt and mixed berries in a glass.', 'Add a layer of granola.', 'Repeat layers until the glass is full.', 'Top with chia seeds and a drizzle of honey.'],
    photo: 'https://images.unsplash.com/photo-1512152272829-e3139592d56f?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Gut Health ----
  {
    id: 'gh1', category: 'Gut Health', name: 'Kimchi Fried Rice Bowl',
    calories: 390, protein: 16, carbs: 52, fat: 13, fiber: 5, prep_time: 20,
    ingredients: ['2 cups cooked rice', '1 cup kimchi, chopped', '2 eggs', 'Green onion', 'Sesame oil', 'Soy sauce'],
    directions: ['Sauté chopped kimchi in sesame oil until fragrant.', 'Add cooked rice and soy sauce, stir-fry until heated through.', 'Fry the eggs sunny-side up separately.', 'Top the rice with fried eggs and sliced green onion.'],
    photo: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'gh2', category: 'Gut Health', name: 'Overnight Oats with Chia & Berries',
    calories: 360, protein: 14, carbs: 54, fat: 10, fiber: 10, prep_time: 5,
    ingredients: ['1/2 cup rolled oats', '1 tbsp chia seeds', '1 cup almond milk', 'Mixed berries', 'Honey'],
    directions: ['Combine oats, chia seeds, and almond milk in a jar.', 'Stir well and refrigerate overnight.', 'Top with mixed berries and a drizzle of honey before eating.'],
    photo: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'gh3', category: 'Gut Health', name: 'Probiotic Yogurt & Granola Bowl',
    calories: 330, protein: 18, carbs: 42, fat: 9, fiber: 6, prep_time: 5,
    ingredients: ['1.5 cups probiotic yogurt', 'Granola', 'Banana slices', 'Flaxseed', 'Honey'],
    directions: ['Spoon probiotic yogurt into a bowl.', 'Top with granola and sliced banana.', 'Sprinkle with flaxseed and drizzle with honey.'],
    photo: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'gh4', category: 'Gut Health', name: 'Miso Soup with Tofu & Seaweed',
    calories: 210, protein: 14, carbs: 18, fat: 9, fiber: 4, prep_time: 15,
    ingredients: ['4 cups dashi broth', '3 tbsp miso paste', 'Silken tofu, cubed', 'Wakame seaweed', 'Green onion'],
    directions: ['Warm the dashi broth over medium heat.', 'Whisk miso paste with a ladle of warm broth, then stir back in.', 'Add tofu cubes and rehydrated wakame; simmer gently.', 'Garnish with sliced green onion and serve.'],
    photo: 'https://images.unsplash.com/photo-1490818387583-1baba5e638af?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'gh5', category: 'Gut Health', name: 'Fermented Veggie Buddha Bowl',
    calories: 400, protein: 15, carbs: 48, fat: 16, fiber: 11, prep_time: 20,
    ingredients: ['1 cup cooked brown rice', 'Sauerkraut', 'Roasted sweet potato', 'Chickpeas', 'Kale', 'Tahini dressing'],
    directions: ['Arrange brown rice, roasted sweet potato, and chickpeas in a bowl.', 'Add a handful of massaged kale and a scoop of sauerkraut.', 'Drizzle with tahini dressing and serve.'],
    photo: 'https://images.unsplash.com/photo-1600335895229-6e75511892c8?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Mediterranean ----
  {
    id: 'med1', category: 'Mediterranean', name: 'Classic Greek Salad',
    calories: 300, protein: 9, carbs: 16, fat: 23, fiber: 4, prep_time: 12,
    ingredients: ['Cucumber', 'Tomatoes', 'Red onion', 'Kalamata olives', 'Feta cheese', 'Olive oil & oregano'],
    directions: ['Chop cucumber, tomatoes, and red onion into chunks.', 'Combine in a bowl with olives and cubed feta.', 'Dress with olive oil, oregano, salt, and pepper.'],
    photo: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'med2', category: 'Mediterranean', name: 'Hummus & Veggie Wrap',
    calories: 380, protein: 14, carbs: 46, fat: 16, fiber: 9, prep_time: 10,
    ingredients: ['Whole wheat wrap', '1/2 cup hummus', 'Cucumber', 'Shredded carrot', 'Spinach', 'Bell pepper strips'],
    directions: ['Spread hummus evenly over the wrap.', 'Layer cucumber, carrot, spinach, and bell pepper.', 'Roll tightly and slice in half to serve.'],
    photo: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'med3', category: 'Mediterranean', name: 'Grilled Halloumi & Chickpea Bowl',
    calories: 460, protein: 22, carbs: 38, fat: 24, fiber: 9, prep_time: 20,
    ingredients: ['Halloumi cheese, sliced', 'Chickpeas', 'Cherry tomatoes', 'Cucumber', 'Mixed greens', 'Lemon-olive oil dressing'],
    directions: ['Grill halloumi slices until golden on both sides.', 'Toss chickpeas, tomatoes, cucumber, and greens in a bowl.', 'Top with grilled halloumi and lemon-olive oil dressing.'],
    photo: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'med4', category: 'Mediterranean', name: 'Mediterranean Baked Cod',
    calories: 350, protein: 34, carbs: 14, fat: 17, fiber: 4, prep_time: 25,
    ingredients: ['6oz cod fillet', 'Cherry tomatoes', 'Kalamata olives', 'Capers', 'Garlic', 'Olive oil'],
    directions: ['Preheat oven to 400°F (200°C).', 'Place cod in a baking dish and surround with tomatoes, olives, capers, and garlic.', 'Drizzle with olive oil and bake for 15-20 minutes.', 'Serve warm with pan juices spooned over the top.'],
    photo: 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'med5', category: 'Mediterranean', name: 'Tabbouleh with Grilled Chicken',
    calories: 420, protein: 33, carbs: 36, fat: 15, fiber: 7, prep_time: 25,
    ingredients: ['Bulgur wheat', 'Parsley, chopped', 'Tomatoes', 'Grilled chicken breast', 'Lemon juice', 'Olive oil'],
    directions: ['Cook bulgur according to package directions and cool.', 'Toss with chopped parsley, tomatoes, lemon juice, and olive oil.', 'Slice grilled chicken and serve over the tabbouleh.'],
    photo: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=500&q=80'
  },
  // ---- GLP-1 Lunch's and Dinner (light, high-protein/fiber, satiating) ----
  {
    id: 'glp1-1', category: "GLP-1 Lunch's and Dinner", name: 'Lentil & Spinach Soup',
    calories: 280, protein: 18, carbs: 40, fat: 5, fiber: 12, prep_time: 30,
    ingredients: ['1 cup red lentils', 'Vegetable broth', 'Spinach', 'Carrot', 'Onion', 'Cumin'],
    directions: ['Sauté onion and carrot until softened.', 'Add lentils, broth, and cumin; simmer 20 minutes until lentils are tender.', 'Stir in spinach until wilted.', 'Blend partially for a creamier texture, if desired.'],
    photo: 'https://images.unsplash.com/photo-1493770348161-369560ae357d?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'glp1-2', category: "GLP-1 Lunch's and Dinner", name: 'Grilled Chicken Lettuce Wraps',
    calories: 300, protein: 34, carbs: 12, fat: 12, fiber: 4, prep_time: 20,
    ingredients: ['Butter lettuce leaves', '6oz grilled chicken, diced', 'Shredded carrot', 'Cucumber', 'Peanut-lime sauce'],
    directions: ['Dice grilled chicken into small pieces.', 'Fill lettuce leaves with chicken, carrot, and cucumber.', 'Drizzle with peanut-lime sauce and wrap to eat.'],
    photo: 'https://images.unsplash.com/photo-1478145046317-39f10e56b5e9?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'glp1-3', category: "GLP-1 Lunch's and Dinner", name: 'Cottage Cheese & Berry Bowl',
    calories: 260, protein: 26, carbs: 24, fat: 6, fiber: 5, prep_time: 5,
    ingredients: ['1.5 cups cottage cheese', 'Mixed berries', 'Sliced almonds', 'Cinnamon'],
    directions: ['Spoon cottage cheese into a bowl.', 'Top with mixed berries and sliced almonds.', 'Finish with a dusting of cinnamon.'],
    photo: 'https://images.unsplash.com/photo-1505576399279-565b52d4ac71?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'glp1-4', category: "GLP-1 Lunch's and Dinner", name: 'Turkey & Veggie Lettuce Cups',
    calories: 290, protein: 30, carbs: 14, fat: 12, fiber: 5, prep_time: 20,
    ingredients: ['Ground turkey', 'Water chestnuts', 'Bell pepper', 'Garlic-ginger sauce', 'Butter lettuce leaves'],
    directions: ['Brown ground turkey in a skillet with garlic-ginger sauce.', 'Stir in diced water chestnuts and bell pepper; cook until tender.', 'Spoon the mixture into lettuce cups to serve.'],
    photo: 'https://images.unsplash.com/photo-1529059997568-3d847b1154f0?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'glp1-5', category: "GLP-1 Lunch's and Dinner", name: 'High-Protein Broccoli Cheddar Soup',
    calories: 310, protein: 24, carbs: 18, fat: 15, fiber: 6, prep_time: 25,
    ingredients: ['Broccoli florets', 'Chicken broth', 'Reduced-fat cheddar', 'Greek yogurt', 'Onion', 'Garlic'],
    directions: ['Simmer broccoli, onion, and garlic in chicken broth until tender.', 'Blend until mostly smooth, leaving some texture.', 'Stir in cheddar and Greek yogurt until melted and creamy.'],
    photo: 'https://images.unsplash.com/photo-1546793665-c74683f339c1?auto=format&fit=crop&w=500&q=80'
  },
  // ---- High Fiber ----
  {
    id: 'hf1', category: 'High Fiber', name: 'Black Bean & Sweet Potato Chili',
    calories: 380, protein: 18, carbs: 58, fat: 8, fiber: 16, prep_time: 35,
    ingredients: ['2 cups black beans', '1 cup diced sweet potato', '1 can diced tomatoes', '1/2 cup corn', 'Chili powder & cumin', 'Onion & garlic'],
    directions: ['Sauté onion and garlic until fragrant.', 'Add sweet potato, tomatoes, and spices; simmer 15 minutes.', 'Stir in black beans and corn; simmer 10 more minutes until sweet potato is tender.', 'Ladle into bowls and serve warm.'],
    photo: 'https://images.unsplash.com/photo-1600335895229-6e75511892c8?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Air Fryer ----
  {
    id: 'af1', category: 'Air Fryer', name: 'Air Fryer Lemon Herb Chicken Thighs',
    calories: 410, protein: 36, carbs: 4, fat: 27, fiber: 1, prep_time: 25,
    ingredients: ['4 boneless chicken thighs', '1 lemon, zested & juiced', '2 tbsp olive oil', 'Garlic powder', 'Dried oregano', 'Salt & pepper'],
    directions: ['Toss chicken thighs with olive oil, lemon zest/juice, and seasonings.', 'Preheat air fryer to 380°F (193°C).', 'Air fry for 16-18 minutes, flipping halfway, until crispy and cooked through.', 'Rest 5 minutes before serving.'],
    photo: 'https://images.unsplash.com/photo-1600628421066-f6bda6a7b976?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Summer Salad ----
  {
    id: 'ss1', category: 'Summer Salad', name: 'Watermelon Feta Salad',
    calories: 260, protein: 7, carbs: 28, fat: 14, fiber: 2, prep_time: 10,
    ingredients: ['3 cups cubed watermelon', '1/2 cup crumbled feta', 'Fresh mint leaves', 'Baby arugula', 'Balsamic glaze', 'Olive oil'],
    directions: ['Combine watermelon cubes and arugula in a large bowl.', 'Scatter crumbled feta and torn mint leaves over the top.', 'Drizzle with olive oil and balsamic glaze.', 'Chill 10 minutes before serving.'],
    photo: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Men's Health ----
  {
    id: 'mh1', category: "Men's Health", name: 'Zinc-Rich Steak & Spinach Bowl',
    calories: 520, protein: 44, carbs: 32, fat: 22, fiber: 7, prep_time: 25,
    ingredients: ['6oz lean sirloin steak', '2 cups baby spinach', '1/2 cup cooked farro', 'Pumpkin seeds', 'Cherry tomatoes', 'Olive oil & balsamic'],
    directions: ['Season steak and sear 3-4 minutes per side; rest and slice.', 'Toss spinach and farro in a bowl with olive oil and balsamic.', 'Top with sliced steak, tomatoes, and pumpkin seeds.', 'Serve immediately.'],
    photo: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Grilling ----
  {
    id: 'gr1', category: 'Grilling', name: 'Grilled BBQ Chicken Skewers',
    calories: 390, protein: 38, carbs: 20, fat: 14, fiber: 3, prep_time: 30,
    ingredients: ['1.5 lb chicken breast, cubed', 'Bell peppers & red onion', '1/2 cup BBQ sauce', 'Olive oil', 'Garlic powder', 'Skewers'],
    directions: ['Thread chicken, peppers, and onion onto skewers.', 'Brush with olive oil and season with garlic powder.', 'Grill over medium-high heat 10-12 minutes, turning and basting with BBQ sauce.', 'Rest 3 minutes before serving.'],
    photo: 'https://images.unsplash.com/photo-1607532941433-304659e8198a?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Women's Health ----
  {
    id: 'wh1', category: "Women's Health", name: 'Iron-Boost Lentil & Beet Salad',
    calories: 340, protein: 16, carbs: 46, fat: 11, fiber: 13, prep_time: 25,
    ingredients: ['1 cup cooked lentils', '1 cup roasted beets, diced', 'Baby spinach', 'Goat cheese', 'Walnuts', 'Lemon vinaigrette'],
    directions: ['Toss lentils and spinach in a bowl.', 'Add roasted beets, crumbled goat cheese, and walnuts.', 'Drizzle with lemon vinaigrette and toss gently.', 'Serve chilled or at room temperature.'],
    photo: 'https://images.unsplash.com/photo-1512152272829-e3139592d56f?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Plant Based Protein ----
  {
    id: 'pbp1', category: 'Plant Based Protein', name: 'Crispy Tofu & Edamame Buddha Bowl',
    calories: 430, protein: 28, carbs: 44, fat: 16, fiber: 10, prep_time: 25,
    ingredients: ['14oz firm tofu, cubed', '1 cup shelled edamame', '1 cup cooked brown rice', 'Shredded carrot', 'Sesame seeds', 'Soy-ginger dressing'],
    directions: ['Press and cube tofu, then pan-fry until crispy on all sides.', 'Arrange brown rice, edamame, and shredded carrot in a bowl.', 'Top with crispy tofu and sesame seeds.', 'Drizzle with soy-ginger dressing before serving.'],
    photo: 'https://images.unsplash.com/photo-1580013759032-c96505e24c1f?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Grab & Go ----
  {
    id: 'gg1', category: 'Grab & Go', name: 'Peanut Butter Protein Energy Bites',
    calories: 220, protein: 12, carbs: 22, fat: 10, fiber: 4, prep_time: 15,
    ingredients: ['1 cup rolled oats', '1/2 cup peanut butter', '1/3 cup protein powder', '2 tbsp honey', 'Mini chocolate chips', '1 tbsp chia seeds'],
    directions: ['Mix oats, peanut butter, protein powder, and honey in a bowl.', 'Fold in chocolate chips and chia seeds.', 'Roll into bite-sized balls.', 'Refrigerate at least 30 minutes before packing to go.'],
    photo: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=500&q=80'
  },
  // ---- GLP-1 Friendly Breakfast ----
  {
    id: 'glpb1', category: 'GLP-1 Friendly Breakfast', name: 'High-Protein Veggie Egg Muffins',
    calories: 240, protein: 22, carbs: 8, fat: 12, fiber: 2, prep_time: 25,
    ingredients: ['8 eggs', '1/2 cup egg whites', 'Spinach & bell pepper, diced', 'Reduced-fat cheese', 'Salt & pepper', 'Cooking spray'],
    directions: ['Preheat oven to 350°F (175°C) and grease a muffin tin.', 'Whisk eggs and egg whites together with salt and pepper.', 'Divide spinach, bell pepper, and cheese among muffin cups; pour egg mixture over top.', 'Bake 18-20 minutes until set.'],
    photo: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?auto=format&fit=crop&w=500&q=80'
  },
  // ---- High Protein Breakfast ----
  {
    id: 'hpb1', category: 'High Protein Breakfast', name: 'Protein Pancakes with Berries',
    calories: 360, protein: 30, carbs: 38, fat: 8, fiber: 5, prep_time: 15,
    ingredients: ['1 cup oat flour', '1 scoop vanilla protein powder', '2 eggs', '3/4 cup cottage cheese', 'Baking powder', 'Mixed berries'],
    directions: ['Blend oat flour, protein powder, eggs, cottage cheese, and baking powder until smooth.', 'Cook 1/4-cup portions on a greased griddle until bubbles form, then flip.', 'Cook 1-2 minutes more until golden.', 'Top with mixed berries and serve.'],
    photo: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=500&q=80'
  },
  // ---- High Protein Lunch and Dinner ----
  {
    id: 'hpld1', category: 'High Protein Lunch and Dinner', name: 'Steak & Sweet Potato Power Plate',
    calories: 540, protein: 45, carbs: 42, fat: 20, fiber: 6, prep_time: 30,
    ingredients: ['6oz sirloin steak', '1 large sweet potato, roasted', 'Steamed broccoli', 'Olive oil', 'Garlic & rosemary', 'Salt & pepper'],
    directions: ['Season steak with garlic, rosemary, salt, and pepper.', 'Sear steak 3-4 minutes per side, then rest and slice.', 'Roast sweet potato wedges at 425°F (220°C) for 25 minutes.', 'Plate steak with sweet potato and steamed broccoli.'],
    photo: 'https://images.unsplash.com/photo-1600628421066-f6bda6a7b976?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Pre Workout ----
  {
    id: 'pw1', category: 'Pre Workout', name: 'Banana Oat Energy Toast',
    calories: 300, protein: 12, carbs: 48, fat: 9, fiber: 6, prep_time: 8,
    ingredients: ['2 slices whole grain toast', '1 banana, sliced', '2 tbsp almond butter', '1 tsp honey', 'Cinnamon', 'Chia seeds'],
    directions: ['Toast the bread until golden.', 'Spread almond butter evenly over each slice.', 'Top with banana slices, a drizzle of honey, and a dusting of cinnamon.', 'Sprinkle with chia seeds and serve 30-45 minutes before training.'],
    photo: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Post Workout ----
  {
    id: 'pow1', category: 'Post Workout', name: 'Chocolate Protein Recovery Smoothie Bowl',
    calories: 340, protein: 30, carbs: 38, fat: 8, fiber: 6, prep_time: 8,
    ingredients: ['1 scoop chocolate protein powder', '1 frozen banana', '3/4 cup milk of choice', '1 tbsp peanut butter', 'Granola', 'Sliced strawberries'],
    directions: ['Blend protein powder, frozen banana, milk, and peanut butter until thick and smooth.', 'Pour into a bowl.', 'Top with granola and sliced strawberries.', 'Enjoy within 30-60 minutes post-workout.'],
    photo: 'https://images.unsplash.com/photo-1512152272829-e3139592d56f?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Under 500 Calories ----
  {
    id: 'u500-1', category: 'Under 500 Calories', name: 'Shrimp & Vegetable Stir-Fry',
    calories: 340, protein: 32, carbs: 24, fat: 12, fiber: 5, prep_time: 20,
    ingredients: ['1 lb shrimp, peeled', 'Broccoli, snap peas & carrots', 'Garlic & ginger', 'Low-sodium soy sauce', '1 tsp sesame oil', 'Green onion'],
    directions: ['Sauté garlic and ginger in sesame oil until fragrant.', 'Add shrimp and cook 2-3 minutes per side until pink.', 'Add vegetables and stir-fry 4-5 minutes until crisp-tender.', 'Toss with soy sauce and garnish with green onion.'],
    photo: 'https://images.unsplash.com/photo-1580013759032-c96505e24c1f?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Breakfast ----
  {
    id: 'bf1', category: 'Breakfast', name: 'Veggie & Cheese Omelette',
    calories: 310, protein: 22, carbs: 8, fat: 20, fiber: 2, prep_time: 12,
    ingredients: ['3 eggs', 'Bell pepper & onion, diced', 'Shredded cheddar', 'Spinach', 'Salt & pepper', '1 tsp butter'],
    directions: ['Whisk eggs with salt and pepper.', 'Melt butter in a nonstick pan and sauté pepper, onion, and spinach.', 'Pour in eggs and cook until mostly set.', 'Sprinkle cheese over half, fold, and serve.'],
    photo: 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Lunch ----
  {
    id: 'ln1', category: 'Lunch', name: 'Chicken Caesar Wrap',
    calories: 420, protein: 32, carbs: 34, fat: 18, fiber: 4, prep_time: 15,
    ingredients: ['Whole wheat wrap', 'Grilled chicken, sliced', 'Romaine lettuce, chopped', 'Parmesan shavings', 'Caesar dressing', 'Cherry tomatoes'],
    directions: ['Lay the wrap flat and layer romaine lettuce down the center.', 'Add sliced chicken, cherry tomatoes, and Parmesan.', 'Drizzle with Caesar dressing.', 'Roll tightly and slice in half to serve.'],
    photo: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Dinner ----
  {
    id: 'dn1', category: 'Dinner', name: 'One-Pan Garlic Butter Salmon & Veggies',
    calories: 460, protein: 38, carbs: 18, fat: 26, fiber: 5, prep_time: 25,
    ingredients: ['6oz salmon fillet', 'Broccoli & baby potatoes', '3 tbsp garlic butter', 'Lemon', 'Fresh parsley', 'Salt & pepper'],
    directions: ['Preheat oven to 400°F (200°C).', 'Arrange salmon, broccoli, and baby potatoes on a sheet pan.', 'Dot with garlic butter and season with salt and pepper.', 'Roast 18-20 minutes; finish with lemon and parsley.'],
    photo: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Immune Support ----
  {
    id: 'imm1', category: 'Immune Support', name: 'Ginger Turmeric Chicken Soup',
    calories: 280, protein: 26, carbs: 20, fat: 10, fiber: 4, prep_time: 35,
    ingredients: ['Shredded chicken breast', 'Carrots & celery, diced', 'Fresh ginger & turmeric', 'Garlic', 'Chicken broth', 'Fresh lemon juice'],
    directions: ['Sauté garlic, ginger, carrots, and celery until fragrant.', 'Add chicken broth and turmeric; bring to a simmer.', 'Stir in shredded chicken and simmer 15 minutes.', 'Finish with fresh lemon juice before serving.'],
    photo: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Vegetarian ----
  {
    id: 'veg1', category: 'Vegetarian', name: 'Chickpea & Spinach Curry',
    calories: 380, protein: 16, carbs: 46, fat: 14, fiber: 11, prep_time: 30,
    ingredients: ['2 cans chickpeas', '4 cups baby spinach', 'Coconut milk', 'Curry powder', 'Diced tomatoes', 'Onion & garlic'],
    directions: ['Sauté onion and garlic until soft.', 'Stir in curry powder, tomatoes, and coconut milk; simmer 10 minutes.', 'Add chickpeas and simmer 10 more minutes.', 'Fold in spinach until wilted and serve over rice.'],
    photo: 'https://images.unsplash.com/photo-1600335895229-6e75511892c8?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Low Carb ----
  {
    id: 'lc1', category: 'Low Carb', name: 'Zucchini Noodle Alfredo with Chicken',
    calories: 420, protein: 36, carbs: 11, fat: 25, fiber: 3, prep_time: 20,
    ingredients: ['2 zucchini, spiralized', '6oz grilled chicken, sliced', 'Heavy cream', 'Parmesan', 'Garlic', 'Butter'],
    directions: ['Sauté garlic in butter, then whisk in cream and Parmesan for the sauce.', 'Toss spiralized zucchini in the sauce over low heat for 2-3 minutes.', 'Top with sliced grilled chicken and serve immediately.'],
    photo: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'lc2', category: 'Low Carb', name: 'Cauliflower Fried Rice',
    calories: 320, protein: 20, carbs: 13, fat: 20, fiber: 6, prep_time: 20,
    ingredients: ['1 head cauliflower, riced', '2 eggs', 'Diced carrot & peas', 'Soy sauce', 'Sesame oil', 'Green onion'],
    directions: ['Rice the cauliflower in a food processor.', 'Scramble eggs in a hot pan, then push to the side.', 'Add cauliflower rice and vegetables; stir-fry until tender.', 'Mix in the eggs, soy sauce, and sesame oil; garnish with green onion.'],
    photo: 'https://images.unsplash.com/photo-1580013759032-c96505e24c1f?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'lc3', category: 'Low Carb', name: 'Baked Chicken Thighs with Broccoli',
    calories: 470, protein: 38, carbs: 9, fat: 31, fiber: 4, prep_time: 35,
    ingredients: ['4 bone-in chicken thighs', 'Broccoli florets', 'Olive oil', 'Garlic powder', 'Paprika'],
    directions: ['Preheat oven to 425°F (220°C).', 'Season chicken thighs with garlic powder and paprika.', 'Roast thighs and broccoli on a sheet pan for 30-35 minutes until crispy and cooked through.'],
    photo: 'https://images.unsplash.com/photo-1600628421066-f6bda6a7b976?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'lc4', category: 'Low Carb', name: 'Egg & Avocado Salad',
    calories: 380, protein: 18, carbs: 10, fat: 30, fiber: 7, prep_time: 15,
    ingredients: ['4 hard-boiled eggs', '1 avocado', 'Celery', 'Red onion', 'Mayo or Greek yogurt', 'Mixed greens'],
    directions: ['Chop hard-boiled eggs and mash avocado together.', 'Fold in celery, red onion, and mayo or Greek yogurt.', 'Serve over a bed of mixed greens.'],
    photo: 'https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'lc5', category: 'Low Carb', name: 'Beef & Pepper Stir-Fry (No Rice)',
    calories: 440, protein: 37, carbs: 13, fat: 26, fiber: 4, prep_time: 20,
    ingredients: ['1 lb sliced beef sirloin', 'Bell peppers', 'Onion', 'Soy sauce', 'Ginger', 'Sesame oil'],
    directions: ['Sear sliced beef in a hot wok until browned; set aside.', 'Stir-fry bell peppers and onion until crisp-tender.', 'Return beef to the wok with soy sauce, ginger, and sesame oil; toss to combine.'],
    photo: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Pantry Staples ----
  {
    id: 'ps1', category: 'Pantry Staples', name: 'Garlic Butter Pasta with Canned Tuna',
    calories: 430, protein: 28, carbs: 52, fat: 12, fiber: 3, prep_time: 20,
    ingredients: ['8oz pasta', '2 cans tuna, drained', '3 cloves garlic, minced', '2 tbsp butter', 'Red pepper flakes', 'Parmesan cheese'],
    directions: ['Cook pasta according to package directions; reserve 1/2 cup pasta water.', 'Melt butter in a skillet and sauté garlic until fragrant.', 'Add tuna and red pepper flakes, breaking the tuna apart gently.', 'Toss with pasta, a splash of pasta water, and Parmesan.'],
    photo: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=500&q=80'
  },
  // ---- Holiday Recipes ----
  {
    id: 'hol1', category: 'Holiday Recipes', name: 'Herb-Roasted Turkey Breast with Cranberry Glaze',
    calories: 380, protein: 42, carbs: 22, fat: 9, fiber: 2, prep_time: 55,
    ingredients: ['2 lb turkey breast', 'Fresh rosemary & thyme', '2 tbsp olive oil', '1/2 cup cranberry sauce', 'Garlic', 'Salt & pepper'],
    directions: ['Preheat oven to 375°F (190°C).', 'Rub turkey breast with olive oil, garlic, herbs, salt, and pepper.', 'Roast 45-50 minutes until internal temperature reaches 165°F (74°C).', 'Rest 10 minutes, then brush with warmed cranberry glaze before slicing.'],
    photo: 'https://images.unsplash.com/photo-1600628421066-f6bda6a7b976?auto=format&fit=crop&w=500&q=80'
  }
];

// The 26 category rows required for Recipe Discovery, in the exact order
// they should render. Every category has at least one authored RECIPE_DB
// entry above; generateCategoryRecipes() pads each row to 10-20 cards.
const RECIPE_CATEGORY_ORDER = [
  'High Fiber', 'Air Fryer', 'Summer Salad', "Men's Health", 'Grilling', "Women's Health",
  'Mediterranean', 'Plant Based Protein', 'Grab & Go', "GLP-1 Lunch's and Dinner", 'GLP-1 Friendly Breakfast',
  'High Protein', 'High Protein Breakfast', 'High Protein Lunch and Dinner', 'Pre Workout', 'Post Workout',
  'Under 500 Calories', 'Breakfast', 'Lunch', 'Dinner', 'Immune Support', 'Vegetarian', 'Low Carb',
  'Gut Health', 'Pantry Staples', 'Holiday Recipes'
];

// Real, already-verified Unsplash photo URLs pulled from RECIPE_DB itself,
// reused (rotated per category) as placeholders for generated card variants
// so every mutated card still points at a working image.
const RECIPE_PHOTO_POOL = [...new Set(RECIPE_DB.map((r) => r.photo))];

const RECIPE_NAME_MODIFIERS = [
  'Quick', 'Zesty', 'Weeknight', 'Family-Style', 'Light', 'Hearty', 'Fresh',
  'Simple', 'Speedy', 'Rustic', 'Classic', 'Bright', 'Cozy', 'Garden', 'Skillet', 'Easy'
];

const RECIPE_INGREDIENT_SWAPS = [
  'baby spinach', 'arugula', 'kale', 'shredded carrots', 'snap peas', 'bell pepper strips',
  'cherry tomatoes', 'sliced cucumber', 'roasted broccoli', 'sautéed mushrooms', 'diced zucchini',
  'shredded red cabbage', 'baby kale', 'watercress', 'microgreens'
];

// Mutates a base recipe into a distinct variant for the given category:
// shifts calories/prep time slightly, swaps a secondary ingredient, and
// rotates in a different (still-real) Unsplash placeholder.
function mutateRecipeForCategory(base, category, seedIndex) {
  const modifier = RECIPE_NAME_MODIFIERS[seedIndex % RECIPE_NAME_MODIFIERS.length];
  const calorieShift = ((seedIndex % 5) - 2) * 15;
  const prepShift = ((seedIndex % 3) - 1) * 4;
  const ingredients = base.ingredients.slice();
  if (ingredients.length > 1) {
    const swapIdx = 1 + (seedIndex % (ingredients.length - 1));
    ingredients[swapIdx] = RECIPE_INGREDIENT_SWAPS[(seedIndex + swapIdx) % RECIPE_INGREDIENT_SWAPS.length];
  }
  return {
    ...base,
    id: `${base.id}-v${seedIndex}`,
    category,
    name: `${modifier} ${base.name}`,
    calories: Math.max(120, base.calories + calorieShift),
    prep_time: Math.max(5, base.prep_time + prepShift),
    ingredients,
    photo: RECIPE_PHOTO_POOL[(seedIndex * 3 + base.id.length) % RECIPE_PHOTO_POOL.length]
  };
}

// Returns 10-20 recipe cards for a category: its authored entries plus, if
// fewer than 10 exist, generated mutations cycled from those same entries.
function generateCategoryRecipes(category) {
  const authored = RECIPE_DB.filter((r) => r.category === category);
  const seeds = authored.length ? authored : RECIPE_DB;
  const result = authored.slice();
  let seedIndex = 0;
  while (result.length < 10 && seedIndex < 40) {
    result.push(mutateRecipeForCategory(seeds[seedIndex % seeds.length], category, seedIndex));
    seedIndex++;
  }
  return result.slice(0, 20);
}

// The full, category-padded recipe list used for rendering (Discovery rows,
// the grid view, and lookups) — built once so repeated renders stay stable.
const FULL_RECIPE_DB = RECIPE_CATEGORY_ORDER.flatMap(generateCategoryRecipes);

// ---------- Recipe Discovery / Learn Feed ----------
const discoveryView = document.getElementById('discoveryView');
const discoveryBackBtn = document.getElementById('discoveryBackBtn');
const recipeCategoryRowsEl = document.getElementById('recipeCategoryRows');
const recipeGridView = document.getElementById('recipeGridView');
const recipeGridBackBtn = document.getElementById('recipeGridBackBtn');
const recipeGridTitleEl = document.getElementById('recipeGridTitle');
const recipeGridSearchInput = document.getElementById('recipeGridSearchInput');
const recipeGridChipsRowEl = document.getElementById('recipeGridChipsRow');
const recipeGridListEl = document.getElementById('recipeGridList');

const RECIPE_CATEGORIES = RECIPE_CATEGORY_ORDER;
let recipeGridCategory = 'all';

// ---------- Recipe bookmarks (localStorage-backed) ----------
const RECIPE_BOOKMARKS_KEY = 'recipeBookmarks';
const recipeBookmarkFilterBtn = document.getElementById('recipeBookmarkFilterBtn');
let recipeBookmarkFilterActive = false;

function getBookmarkedRecipeIds() {
  try {
    return JSON.parse(localStorage.getItem(RECIPE_BOOKMARKS_KEY)) || [];
  } catch {
    return [];
  }
}
function isRecipeBookmarked(id) {
  return getBookmarkedRecipeIds().includes(id);
}
function toggleRecipeBookmark(id) {
  const ids = getBookmarkedRecipeIds();
  const idx = ids.indexOf(id);
  const nowSaved = idx === -1;
  if (nowSaved) ids.push(id);
  else ids.splice(idx, 1);
  localStorage.setItem(RECIPE_BOOKMARKS_KEY, JSON.stringify(ids));
  return nowSaved;
}
function bookmarkButtonHtml(id) {
  const saved = isRecipeBookmarked(id);
  return `
    <button type="button" class="recipe-card-bookmark-btn${saved ? ' saved' : ''}" data-bookmark-id="${id}" aria-label="${saved ? 'Remove bookmark' : 'Bookmark recipe'}" aria-pressed="${saved}">
      <svg viewBox="0 0 24 24" class="bookmark-ribbon-icon" aria-hidden="true"><path d="M6 3.5c0-.55.45-1 1-1h10c.55 0 1 .45 1 1v17l-6-4-6 4v-17z"/></svg>
    </button>
  `;
}
function handleBookmarkBtnClick(btn, onToggled) {
  const saved = toggleRecipeBookmark(btn.dataset.bookmarkId);
  if (recipeBookmarkFilterActive) {
    onToggled();
    return;
  }
  btn.classList.toggle('saved', saved);
  btn.setAttribute('aria-pressed', String(saved));
  btn.setAttribute('aria-label', saved ? 'Remove bookmark' : 'Bookmark recipe');
}

function renderRecipeDiscovery() {
  const rows = RECIPE_CATEGORIES.map((cat) => {
    const recipes = FULL_RECIPE_DB.filter((r) => r.category === cat && (!recipeBookmarkFilterActive || isRecipeBookmarked(r.id)));
    if (!recipes.length) return '';
    return `
    <section class="recipe-category-row">
      <div class="recipe-category-row-header">
        <h2 class="wr-category-title">${escapeHtml(cat)}</h2>
        <button type="button" class="recipe-view-more-btn" data-category="${escapeHtml(cat)}">View More ›</button>
      </div>
      <div class="wr-carousel">
        ${recipes.map((r) => `
          <article class="wr-card recipe-carousel-card" data-recipe-id="${r.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(r.name)} details">
            <img class="wr-card-thumb" src="${r.photo}" alt="${escapeHtml(r.name)}" loading="lazy" />
            <h3 class="wr-card-title">${escapeHtml(r.name)}</h3>
            <div class="recipe-card-footer-row">
              <span class="wr-card-meta">⏱ ${r.prep_time} min · ${r.calories} Cal</span>
              ${bookmarkButtonHtml(r.id)}
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
  }).join('');
  recipeCategoryRowsEl.innerHTML = rows || '<p class="empty-state">No bookmarked recipes yet.</p>';
}

recipeBookmarkFilterBtn.addEventListener('click', () => {
  recipeBookmarkFilterActive = !recipeBookmarkFilterActive;
  recipeBookmarkFilterBtn.classList.toggle('active', recipeBookmarkFilterActive);
  recipeBookmarkFilterBtn.setAttribute('aria-pressed', String(recipeBookmarkFilterActive));
  renderRecipeDiscovery();
});

function findRecipeById(id) {
  return FULL_RECIPE_DB.find((r) => r.id === id);
}

// Adapts a RECIPE_DB entry onto the field names the shared #recipe-modal
// expects (img/kcal/instructions), keeping the original fields (calories,
// fiber, prep_time) alongside so the modal's extra meta pills can read them.
function openRecipeFromDb(recipe) {
  openRecipeModal({ ...recipe, img: recipe.photo, kcal: recipe.calories, instructions: recipe.directions });
}

recipeCategoryRowsEl.addEventListener('click', (e) => {
  const bookmarkBtn = e.target.closest('.recipe-card-bookmark-btn');
  if (bookmarkBtn) { handleBookmarkBtnClick(bookmarkBtn, renderRecipeDiscovery); return; }
  const moreBtn = e.target.closest('.recipe-view-more-btn');
  if (moreBtn) { openRecipeGridView(moreBtn.dataset.category); return; }
  const card = e.target.closest('.recipe-carousel-card');
  if (!card) return;
  const recipe = findRecipeById(card.dataset.recipeId);
  if (recipe) openRecipeFromDb(recipe);
});
recipeCategoryRowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.recipe-card-bookmark-btn')) return;
  const card = e.target.closest('.recipe-carousel-card');
  if (!card) return;
  e.preventDefault();
  const recipe = findRecipeById(card.dataset.recipeId);
  if (recipe) openRecipeFromDb(recipe);
});

async function openDiscoveryView() {
  renderRecipeDiscovery();
  openSubView(discoveryView);
}
discoveryBackBtn.addEventListener('click', () => closeSubView(discoveryView));

// Populates the category filter chips row once, from RECIPE_CATEGORY_ORDER,
// keeping the "All" chip that's already hardcoded in index.html.
function renderRecipeGridChips() {
  if (recipeGridChipsRowEl.childElementCount > 1) return;
  recipeGridChipsRowEl.insertAdjacentHTML('beforeend', RECIPE_CATEGORY_ORDER.map((cat) => `
    <button type="button" class="progress-subnav-btn" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
  `).join(''));
}

function renderRecipeGrid() {
  const q = recipeGridSearchInput.value.trim().toLowerCase();
  const filtered = FULL_RECIPE_DB.filter((r) => {
    const matchesCategory = recipeGridCategory === 'all' || r.category === recipeGridCategory;
    const matchesQuery = !q || r.name.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
  const visible = recipeBookmarkFilterActive ? filtered.filter((r) => isRecipeBookmarked(r.id)) : filtered;
  recipeGridListEl.innerHTML = visible.length
    ? visible.map((r) => `
        <article class="recipe-grid-card" data-recipe-id="${r.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(r.name)} details">
          <img class="recipe-grid-card-thumb" src="${r.photo}" alt="${escapeHtml(r.name)}" loading="lazy" />
          <span class="recipe-grid-card-name">${escapeHtml(r.name)}</span>
          <div class="recipe-card-footer-row">
            <span class="recipe-grid-card-meta">${r.calories} Cal</span>
            ${bookmarkButtonHtml(r.id)}
          </div>
        </article>
      `).join('')
    : `<p class="empty-state">${recipeBookmarkFilterActive ? 'No bookmarked recipes yet.' : 'No recipes match your search.'}</p>`;
}

function openRecipeGridView(category) {
  renderRecipeGridChips();
  recipeGridCategory = category || 'all';
  recipeGridTitleEl.textContent = recipeGridCategory === 'all' ? 'All Recipes' : recipeGridCategory;
  recipeGridSearchInput.value = '';
  recipeGridChipsRowEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.category === recipeGridCategory));
  renderRecipeGrid();
  recipeGridView.classList.add('open');
}
function closeRecipeGridView() { recipeGridView.classList.remove('open'); }
recipeGridBackBtn.addEventListener('click', closeRecipeGridView);

recipeGridSearchInput.addEventListener('input', renderRecipeGrid);
recipeGridChipsRowEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  recipeGridCategory = btn.dataset.category;
  recipeGridChipsRowEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderRecipeGrid();
});
recipeGridListEl.addEventListener('click', (e) => {
  const bookmarkBtn = e.target.closest('.recipe-card-bookmark-btn');
  if (bookmarkBtn) { handleBookmarkBtnClick(bookmarkBtn, renderRecipeGrid); return; }
  const card = e.target.closest('.recipe-grid-card');
  if (!card) return;
  const recipe = findRecipeById(card.dataset.recipeId);
  if (recipe) openRecipeFromDb(recipe);
});

// ---------- Apps & Devices ----------
const appsDevicesView = document.getElementById('appsDevicesView');
const appsDevicesBackBtn = document.getElementById('appsDevicesBackBtn');
const appsDevicesGridEl = document.getElementById('appsDevicesGrid');
const deviceConnectOverlay = document.getElementById('deviceConnectOverlay');
const deviceConnectTitleEl = document.getElementById('deviceConnectTitle');
const deviceConnectLogoEl = document.getElementById('deviceConnectLogo');
const deviceConnectDescEl = document.getElementById('deviceConnectDesc');
const deviceConnectActionBtn = document.getElementById('deviceConnectActionBtn');
const closeDeviceConnectModal = document.getElementById('closeDeviceConnectModal');

function renderAppsDevicesGrid() {
  appsDevicesGridEl.querySelectorAll('.apps-device-card').forEach((card) => {
    const connected = Boolean(state.devices?.[card.dataset.device]);
    card.classList.toggle('connected', connected);
    card.querySelector('.apps-device-badge').textContent = connected ? '✓ Connected' : 'Connect';
  });
}

async function openAppsDevicesView() {
  await loadDevices();
  renderAppsDevicesGrid();
  openSubView(appsDevicesView);
}
appsDevicesBackBtn.addEventListener('click', () => closeSubView(appsDevicesView));

// ---------- Device Connect Modal ----------
const DEVICE_INFO = {
  garmin: { name: 'Garmin', icon: '⌚', desc: 'Sync your steps, heart rate, and workouts from Garmin Connect.' },
  fitbit: { name: 'Fitbit', icon: '⌚', desc: 'Sync your steps, heart rate, and workouts from Fitbit.' },
  strava: { name: 'Strava', icon: '🏃', desc: 'Sync your runs and rides straight into your Cardio diary.' },
  myFitnessPal: { name: 'MyFitnessPal', icon: '🍽️', desc: 'Import your food diary history from MyFitnessPal.' }
};
let activeDeviceKey = null;

function renderDeviceConnectModal() {
  const info = DEVICE_INFO[activeDeviceKey];
  const connected = Boolean(state.devices?.[activeDeviceKey]);
  deviceConnectTitleEl.textContent = info.name;
  deviceConnectLogoEl.textContent = info.icon;
  deviceConnectDescEl.textContent = info.desc;
  deviceConnectActionBtn.textContent = connected ? 'Disconnect Device' : 'Connect Device';
  deviceConnectActionBtn.classList.toggle('btn-danger', connected);
  deviceConnectActionBtn.classList.toggle('btn-primary', !connected);
}

appsDevicesGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.apps-device-card');
  if (!card) return;
  activeDeviceKey = card.dataset.device;
  renderDeviceConnectModal();
  deviceConnectOverlay.classList.add('open');
});

function closeDeviceConnectModalFn() {
  deviceConnectOverlay.classList.remove('open');
  activeDeviceKey = null;
}
closeDeviceConnectModal.addEventListener('click', closeDeviceConnectModalFn);
deviceConnectOverlay.addEventListener('click', (e) => { if (e.target === deviceConnectOverlay) closeDeviceConnectModalFn(); });

deviceConnectActionBtn.addEventListener('click', async () => {
  if (!activeDeviceKey) return;
  const key = activeDeviceKey;
  const next = !state.devices?.[key];
  try {
    const res = await authFetch(`${API}/devices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update device');
    state.devices = data;
    localStorage.setItem(`${key}_connected`, String(next));
    renderAppsDevicesGrid();
    renderDeviceConnectModal();

    if (next && (key === 'garmin' || key === 'fitbit')) {
      const stepsRes = await authFetch(`${API}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayStr(), steps: 8420 })
      });
      if (stepsRes.ok) {
        await loadSteps(true);
        renderCalorieBar();
        if (exerciseHubView.classList.contains('open')) {
          renderExerciseAdjustmentCard();
        }
      }
    } else if (next && key === 'strava') {
      const exerciseRes = await authFetch(`${API}/exercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayStr(), type: 'cardio', name: 'Morning Run', minutes: 30, caloriesBurned: 350 })
      });
      if (exerciseRes.ok) {
        const entry = await exerciseRes.json();
        state.exercise.unshift(entry);
        renderExercise();
        renderCalorieBar();
        if (exerciseHubView.classList.contains('open')) {
          renderExerciseHubEntryList();
        }
      }
    }

    showToast(next ? 'Connected' : 'Disconnected');
    closeDeviceConnectModalFn();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- Weekly Report ----------
const weeklyReportView = document.getElementById('weeklyReportView');
const weeklyReportBackBtn = document.getElementById('weeklyReportBackBtn');
const weeklyReportRingProgressEl = document.getElementById('weeklyReportRingProgress');
const weeklyReportRingValueEl = document.getElementById('weeklyReportRingValue');
const weeklyReportChartAxisEl = document.getElementById('weeklyReportChartAxis');
const weeklyReportChartSvgEl = document.getElementById('weeklyReportChartSvg');
const weeklyReportAveragesListEl = document.getElementById('weeklyReportAveragesList');

function renderWeeklyReportChart(days, goal) {
  weeklyReportChartAxisEl.innerHTML = '';
  weeklyReportChartSvgEl.innerHTML = '';
  if (days.length === 0) return;

  const maxVal = Math.max(goal, ...days.map((d) => d.calories), 1);
  const ceiling = niceCeil(maxVal);
  for (let i = 4; i >= 0; i--) {
    const span = document.createElement('span');
    span.textContent = Math.round((ceiling / 4) * i);
    weeklyReportChartAxisEl.appendChild(span);
  }

  const width = 300;
  const height = 140;
  const padY = 6;
  const plotHeight = height - padY * 2;
  const stepX = days.length > 1 ? width / (days.length - 1) : 0;
  const toY = (v) => padY + plotHeight - (Math.min(v, ceiling) / ceiling) * plotHeight;
  const actualPoints = days.map((d, i) => `${(days.length > 1 ? i * stepX : width / 2).toFixed(1)},${toY(d.calories).toFixed(1)}`).join(' ');
  const goalPoints = days.map((d, i) => `${(days.length > 1 ? i * stepX : width / 2).toFixed(1)},${toY(goal).toFixed(1)}`).join(' ');
  const gridLines = [0, 1, 2, 3, 4]
    .map((i) => {
      const y = (padY + (plotHeight / 4) * i).toFixed(1);
      return `<line class="macro-history-grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}" />`;
    })
    .join('');
  weeklyReportChartSvgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  weeklyReportChartSvgEl.innerHTML = `
    ${gridLines}
    <polyline class="macro-history-line" style="stroke: var(--text-3);" points="${goalPoints}" />
    <polyline class="macro-history-line cyan" points="${actualPoints}" />
  `;
}

function renderWeeklyAverages(averages) {
  const goal = state.settings || {};
  const rows = [
    { label: 'Calories', value: averages.calories, target: goal.calorieGoal || 0 },
    { label: 'Protein', value: averages.protein, target: goal.macroGoals?.protein || 0 },
    { label: 'Carbs', value: averages.carbs, target: goal.macroGoals?.carbs || 0 },
    { label: 'Fat', value: averages.fat, target: goal.macroGoals?.fat || 0 }
  ];
  weeklyReportAveragesListEl.innerHTML = rows
    .map((r) => {
      const pct = r.target > 0 ? Math.min(100, Math.round((r.value / r.target) * 100)) : 0;
      return `
        <div class="wra-row">
          <div class="wra-row-top">
            <span class="wra-row-label">${r.label}</span>
            <span class="wra-row-value">${Math.round(r.value)} / ${r.target}</span>
          </div>
          <div class="wra-track"><div class="wra-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    })
    .join('');
}

async function openWeeklyReportView() {
  openSubView(weeklyReportView);
  const history = await loadHistory({ days: 7 });
  if (!history) return;
  const goal = state.settings?.calorieGoal || 0;
  const compliantDays = history.days.filter((d) => d.calories > 0 && d.calories >= goal * 0.8 && d.calories <= goal * 1.1).length;
  const compliancePct = history.days.length ? compliantDays / history.days.length : 0;
  setRingProgress(weeklyReportRingProgressEl, compliancePct);
  weeklyReportRingValueEl.textContent = `${Math.round(compliancePct * 100)}%`;
  renderWeeklyReportChart(history.days, goal);
  renderWeeklyAverages(history.averages);
}
weeklyReportBackBtn.addEventListener('click', () => closeSubView(weeklyReportView));

// ---------- Community Connect Onboarding ----------
// Shown once per account (gated by settings.communityConnected) before the
// Community feed below, mirroring the app's existing More-tab sub-view pattern.
const communitySubview = document.getElementById('community-subview');
const communitySubviewBackBtn = document.getElementById('communitySubviewBackBtn');
const communitySubviewDoneBtn = document.getElementById('communitySubviewDoneBtn');
const communityHamburgerBtn = document.getElementById('communityHamburgerBtn');
const communitySearchBtn = document.getElementById('communitySearchBtn');
const communitySiteNav = document.getElementById('community-site-nav');
const communitySiteNavCloseBtn = document.getElementById('communitySiteNavCloseBtn');
const communityConnectForm = document.getElementById('communityConnectForm');
const communityConnectError = document.getElementById('communityConnectError');
const communityPronounsInput = document.getElementById('communityPronounsInput');
const communityWhyHereInput = document.getElementById('communityWhyHereInput');
const communityHobbiesInput = document.getElementById('communityHobbiesInput');
const communityFunFactInput = document.getElementById('communityFunFactInput');
const communityBioInput = document.getElementById('communityBioInput');

function openCommunitySubview() {
  openSubView(communitySubview);
}
communitySubviewBackBtn.addEventListener('click', () => closeSubView(communitySubview));

communityHamburgerBtn.addEventListener('click', () => communitySiteNav.classList.remove('hidden'));
communitySiteNavCloseBtn.addEventListener('click', () => communitySiteNav.classList.add('hidden'));
communitySiteNav.addEventListener('click', (e) => {
  const link = e.target.closest('.site-nav-link');
  if (!link) return;
  e.preventDefault();
  communitySiteNav.classList.add('hidden');
  showToast('Coming soon');
});
communitySearchBtn.addEventListener('click', () => showToast('Coming soon'));

communityConnectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  communityConnectError.textContent = '';
  const payload = {
    communityPronouns: communityPronounsInput.value,
    communityWhyHere: communityWhyHereInput.value.trim(),
    communityHobbies: communityHobbiesInput.value.trim(),
    communityFunFact: communityFunFactInput.value.trim(),
    communityBio: communityBioInput.value.trim(),
    communityConnected: true
  };
  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save Community profile');
    state.settings = data;
    showToast('Connected to Pure Macros community');
    closeSubView(communitySubview);
    openCommunityView();
  } catch (err) {
    communityConnectError.textContent = err.message;
  }
});
communitySubviewDoneBtn.addEventListener('click', () => communityConnectForm.requestSubmit());

// ---------- Community Forum ----------
const communityView = document.getElementById('communityView');
const communityBackBtn = document.getElementById('communityBackBtn');
const communityCreatePostBtn = document.getElementById('communityCreatePostBtn');
const communityFeedTabsEl = document.getElementById('communityFeedTabs');
const communityComposerInput = document.getElementById('communityComposerInput');
const communityComposerSendBtn = document.getElementById('communityComposerSendBtn');
const communityFeedEl = document.getElementById('communityFeed');

// Client-side mock feed — there is no community/social backend, so posts and
// likes live only for the current session (kept out of `state` since they're
// not tied to the logged-in user's persisted data).
const COMMUNITY_POSTS = [
  { id: 1, group: false, author: 'Jamie Rivera', avatar: '🧑', time: '2h ago', text: 'Hit a new PR on deadlifts this morning and stayed under my calorie goal. Small wins add up! #strengthgains', likes: 24, comments: 5, liked: false },
  { id: 2, group: true, author: 'Priya Natarajan', avatar: '👩', time: '4h ago', text: 'Meal prepped 5 days of high-protein lunches in under an hour. Recipe is in the Learn hub if anyone wants it. #mealprep', likes: 41, comments: 12, liked: false },
  { id: 3, group: false, author: 'Marcus Cole', avatar: '🧔', time: '6h ago', text: 'Anyone else find that logging water actually helps you stop snacking at night? Total game changer for me. #hydration', likes: 17, comments: 3, liked: false },
  { id: 4, group: true, author: 'Sofia Alvarez', avatar: '👩', time: 'Yesterday', text: 'Week 6 of the Push Group challenge done. Down 2.4 lbs and feeling stronger every session. #pushgroup #progress', likes: 63, comments: 21, liked: false },
  { id: 5, group: false, author: 'Devon Park', avatar: '🧑', time: 'Yesterday', text: 'Swapped my afternoon soda for sparkling water with lime. Saved about 150 calories a day without even trying. #smallwins', likes: 29, comments: 8, liked: false }
];
let communityActiveFeed = 'all';
let communityPostSeq = COMMUNITY_POSTS.length;

function renderCommunityFeed() {
  const posts = communityActiveFeed === 'groups' ? COMMUNITY_POSTS.filter((p) => p.group) : COMMUNITY_POSTS;
  communityFeedEl.innerHTML = posts
    .map((p) => {
      const textHtml = escapeHtml(p.text).replace(/#(\w+)/g, '<span class="community-post-hashtag">#$1</span>');
      return `
        <div class="community-post" data-post-id="${p.id}">
          <div class="community-post-head">
            <span class="community-post-avatar" aria-hidden="true">${p.avatar}</span>
            <div class="community-post-identity">
              <span class="community-post-name">${escapeHtml(p.author)}</span>
              <span class="community-post-time">${p.time}</span>
            </div>
            ${p.group ? '<span class="community-post-group-badge">Group</span>' : ''}
          </div>
          <p class="community-post-text">${textHtml}</p>
          <div class="community-post-actions">
            <button type="button" class="community-post-action ${p.liked ? 'liked' : ''}" data-action="like">
              <span class="community-post-action-icon" aria-hidden="true">${p.liked ? '❤️' : '🤍'}</span> ${p.likes}
            </button>
            <button type="button" class="community-post-action" data-action="comment">
              <span aria-hidden="true">💬</span> ${p.comments}
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

communityFeedTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  communityActiveFeed = btn.dataset.feed;
  communityFeedTabsEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderCommunityFeed();
});

communityFeedEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.community-post-action');
  if (!btn) return;
  const postEl = btn.closest('.community-post');
  const post = COMMUNITY_POSTS.find((p) => p.id === Number(postEl.dataset.postId));
  if (!post) return;
  if (btn.dataset.action === 'like') {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    renderCommunityFeed();
  } else {
    showToast('Comments coming soon');
  }
});

function submitCommunityPost() {
  const text = communityComposerInput.value.trim();
  if (!text) return;
  communityPostSeq += 1;
  COMMUNITY_POSTS.unshift({
    id: communityPostSeq,
    group: communityActiveFeed === 'groups',
    author: state.user?.username || 'You',
    avatar: '👤',
    time: 'Just now',
    text,
    likes: 0,
    comments: 0,
    liked: false
  });
  communityComposerInput.value = '';
  renderCommunityFeed();
  showToast('Posted');
}

communityComposerSendBtn.addEventListener('click', submitCommunityPost);
communityComposerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitCommunityPost();
  }
});
communityCreatePostBtn.addEventListener('click', () => communityComposerInput.focus());

function openCommunityView() {
  renderCommunityFeed();
  openSubView(communityView);
}
communityBackBtn.addEventListener('click', () => closeSubView(communityView));

// ---------- Learn Content Hub ----------
const learnView = document.getElementById('learnView');
const learnBackBtn = document.getElementById('learnBackBtn');
const learnChipsRowEl = document.getElementById('learnChipsRow');
const learnGridEl = document.getElementById('learnGrid');

const LEARN_ARTICLES = [
  { id: 1, category: 'nutrition', title: 'Protein Timing: Does It Really Matter?', desc: 'What the research says about pre- and post-workout protein windows.', img: 'https://images.unsplash.com/photo-1593079831268-3381b0db4a77?auto=format&fit=crop&w=800&q=80', rd: true },
  { id: 2, category: 'nutrition', title: 'Reading Nutrition Labels Like a Pro', desc: 'Spot hidden sugars and serving-size tricks in under a minute.', img: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=800&q=80', rd: true },
  { id: 3, category: 'training', title: 'Progressive Overload for Beginners', desc: 'The one principle that drives almost all strength gains.', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=800&q=80', rd: false },
  { id: 4, category: 'training', title: 'Zone 2 Cardio Explained', desc: 'Why easy runs build the biggest aerobic base.', img: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=800&q=80', rd: false },
  { id: 5, category: 'success-stories', title: 'How Elena Lost 40lbs Without Giving Up Pizza', desc: 'A real member story on sustainable, flexible dieting.', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80', rd: false },
  { id: 6, category: 'app-101', title: 'Getting the Most Out of the Steps Hub', desc: 'Connect a device and auto-sync your daily activity.', img: 'https://images.unsplash.com/photo-1508962914676-134849a727f0?auto=format&fit=crop&w=800&q=80', rd: false },
  { id: 7, category: 'app-101', title: 'Setting Smarter Macro Goals', desc: 'A quick walkthrough of the Goals sub-page.', img: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=800&q=80', rd: false },
  {
    id: 8,
    category: 'nutrition',
    tags: ['nutrition', 'gut-health', 'getting-started'],
    title: 'Benefits of Eating Whole Foods: Fuel Your Body Naturally',
    desc: 'Why single-ingredient, unprocessed foods are the ultimate secret weapon for stable energy, muscle recovery, and long-term gut health.',
    img: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=800&q=80',
    rd: true,
    readTime: '6 minute read'
  }
];
let learnActiveCategory = 'all';

function renderLearnGrid() {
  const filtered =
    learnActiveCategory === 'all'
      ? LEARN_ARTICLES
      : LEARN_ARTICLES.filter((a) => a.category === learnActiveCategory || (a.tags && a.tags.includes(learnActiveCategory)));
  learnGridEl.innerHTML = filtered
    .map(
      (a) => `
        <div class="learn-card" data-article-id="${a.id}">
          <div class="learn-card-banner" style="background-image: url('${a.img}')"></div>
          ${a.rd ? '<span class="learn-card-tag">✅ RD Approved</span>' : ''}
          <h3 class="learn-card-title">${escapeHtml(a.title)}</h3>
          <p class="learn-card-desc">${escapeHtml(a.desc)}</p>
          <div class="learn-card-footer">
            ${a.readTime ? `<span class="learn-card-readtime">${escapeHtml(a.readTime)}</span>` : ''}
            <button type="button" class="learn-card-cta" data-article-id="${a.id}">Read Article →</button>
          </div>
        </div>
      `
    )
    .join('');
}

learnChipsRowEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  learnActiveCategory = btn.dataset.category;
  learnChipsRowEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderLearnGrid();
});

learnGridEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.learn-card-cta');
  if (!btn) return;
  const article = LEARN_ARTICLES.find((a) => a.id === Number(btn.dataset.articleId));
  if (article) openArticleReader(article);
});

function openLearnView() {
  renderLearnGrid();
  openSubView(learnView);
}
learnBackBtn.addEventListener('click', () => closeSubView(learnView));

// ---------- Article Reader Mode (fullscreen overlay) ----------
// Structural body content for each LEARN_ARTICLES entry (matched by id) —
// kept as its own array, separate from the teaser metadata above, so the
// grid's card copy and the full reader body can evolve independently.
const ARTICLES_DB = [
  { id: 1, blocks: [
    { type: 'p', text: "Protein timing gets a lot of hype, but the research paints a more relaxed picture than most fitness influencers let on." },
    { type: 'h2', text: 'The "Anabolic Window" Myth' },
    { type: 'p', text: 'For decades, lifters raced to down a shake within 30 minutes of finishing a workout. More recent research shows that window is far wider than once believed — closer to several hours, not minutes.' },
    { type: 'h3', text: 'What actually matters' },
    { type: 'bullets', items: ['Total daily protein intake', 'Consistent intake spread across meals', 'Getting enough protein per meal (roughly 25-40g)'] },
    { type: 'h2', text: 'So Should You Ignore Timing Completely?' },
    { type: 'p', text: 'Not entirely. If you train fasted or go many hours between meals, having protein reasonably close to your session is still a sensible default — just don’t stress over the clock.' }
  ]},
  { id: 2, blocks: [
    { type: 'p', text: 'Nutrition labels are designed to be skimmed — which is exactly why hidden sugars and inflated serving sizes slip past so many shoppers.' },
    { type: 'h2', text: 'Start With the Serving Size' },
    { type: 'p', text: 'Every number on the label is scaled to the serving size at the top — and it’s often smaller than what you’d actually eat in one sitting.' },
    { type: 'h3', text: 'Spotting Hidden Sugar' },
    { type: 'bullets', items: ['Check "Added Sugars", not just "Total Sugars"', 'Watch for syrup, dextrose, and maltose in the ingredient list', 'Ingredients are listed by weight — sugar near the top is a red flag'] },
    { type: 'h2', text: 'The 5-Second Label Check' },
    { type: 'p', text: 'Glance at serving size, added sugar, and fiber — in that order — and you’ll catch 90% of what actually matters before you’ve even reached the aisle’s end.' }
  ]},
  { id: 3, blocks: [
    { type: 'p', text: 'If there’s one principle that explains almost all long-term strength gains, it’s progressive overload.' },
    { type: 'h2', text: 'What Progressive Overload Actually Means' },
    { type: 'p', text: 'It’s the gradual increase of stress placed on the body during training — more weight, more reps, more sets, or better form over time.' },
    { type: 'h3', text: 'Simple Ways to Apply It' },
    { type: 'bullets', items: ['Add small amounts of weight week to week', 'Add one extra rep before adding weight', 'Slow down the eccentric (lowering) portion of a lift', 'Reduce rest time between sets'] },
    { type: 'h2', text: 'Avoiding the Common Mistake' },
    { type: 'p', text: 'Beginners often chase overload too fast and sacrifice form. Track your lifts, aim for small consistent increases, and let strength build session over session, not workout over workout.' }
  ]},
  { id: 4, blocks: [
    { type: 'p', text: 'Zone 2 cardio — the easy, conversational-pace training zone — quietly does more for your aerobic engine than most people expect.' },
    { type: 'h2', text: 'What Is Zone 2?' },
    { type: 'p', text: 'It’s a heart-rate zone (roughly 60-70% of max heart rate) where you can still hold a conversation, but not sing comfortably.' },
    { type: 'h3', text: 'Why It Builds the Biggest Base' },
    { type: 'bullets', items: ['Trains your body to burn fat more efficiently for fuel', 'Increases mitochondrial density over time', 'Low enough intensity to recover quickly and train often'] },
    { type: 'h2', text: 'How Much Is Enough?' },
    { type: 'p', text: 'Most endurance athletes spend 70-80% of their total training volume in this easy zone — it’s the unglamorous foundation the harder workouts are built on top of.' }
  ]},
  { id: 5, blocks: [
    { type: 'p', text: "Elena’s story isn’t about willpower — it’s about building a system flexible enough to survive real life, pizza night included." },
    { type: 'h2', text: 'The Turning Point' },
    { type: 'p', text: 'After years of all-or-nothing diets, Elena switched to tracking her food instead of eliminating entire food groups — and started losing weight without the burnout.' },
    { type: 'h3', text: 'What Changed' },
    { type: 'bullets', items: ['Logged meals daily instead of "starting over" each Monday', 'Built a calorie budget flexible enough for social meals', 'Prioritized protein and fiber to stay full on fewer calories'] },
    { type: 'h2', text: 'Her Advice For Anyone Starting Out' },
    { type: 'p', text: '"Consistency beats perfection. I still eat pizza — I just plan around it instead of feeling guilty afterward."' }
  ]},
  { id: 6, blocks: [
    { type: 'p', text: 'The Steps Hub becomes far more useful once it’s syncing automatically instead of relying on manual entries.' },
    { type: 'h2', text: 'Connecting a Device' },
    { type: 'p', text: 'Head to More › Apps & Devices and connect a supported wearable or phone pedometer to start auto-syncing your daily step count.' },
    { type: 'h3', text: 'What You Unlock' },
    { type: 'bullets', items: ['Automatic daily step totals, no manual typing', 'Step-based calorie adjustments on high-activity days', 'A longer history to spot activity trends over time'] },
    { type: 'h2', text: 'Troubleshooting Sync Issues' },
    { type: 'p', text: 'If steps stop updating, try forcing a manual sync from the Sync Status screen — most gaps are resolved by simply reconnecting the device.' }
  ]},
  { id: 7, blocks: [
    { type: 'p', text: 'Calorie goals only tell half the story — macro goals decide whether those calories come from muscle-preserving protein or just empty carbs.' },
    { type: 'h2', text: 'Where to Set Macro Goals' },
    { type: 'p', text: 'Open More › Goals › Additional Nutrient Goals to set specific gram targets for protein, carbs, and fat instead of relying on the default split.' },
    { type: 'h3', text: 'A Reasonable Starting Split' },
    { type: 'bullets', items: ['Protein: about 0.7-1g per pound of bodyweight', 'Fat: about 25-30% of total calories', 'Carbs: fill in the remainder based on activity level'] },
    { type: 'h2', text: 'Adjust as You Go' },
    { type: 'p', text: 'Treat your first split as a starting point — revisit it every few weeks based on hunger, energy, and progress toward your goal.' }
  ]},
  { id: 8, blocks: [
    { type: 'p', text: 'Whole, single-ingredient foods do more than fill you up — they’re quietly responsible for stable energy, faster recovery, and a healthier gut.' },
    { type: 'h2', text: 'What Counts as a Whole Food?' },
    { type: 'p', text: 'Foods close to their natural state — vegetables, fruit, whole grains, lean meats, legumes — with little to no processing or added ingredients.' },
    { type: 'h3', text: 'The Gut Health Connection' },
    { type: 'bullets', items: ['Fiber from whole foods feeds beneficial gut bacteria', 'Fewer additives means less irritation for sensitive digestive systems', 'Diverse plant foods support a more diverse gut microbiome'] },
    { type: 'h2', text: 'Easy Swaps to Start With' },
    { type: 'bullets', items: ['Swap fruit juice for whole fruit', 'Swap white bread for 100% whole grain', 'Swap flavored yogurt for plain yogurt plus fresh fruit'] },
    { type: 'h2', text: 'The Takeaway' },
    { type: 'p', text: 'You don’t need to overhaul every meal overnight — a handful of whole-food swaps each week compounds into real, lasting change.' }
  ]}
];

const articleReaderModal = document.getElementById('articleReaderModal');
const articleReaderSheetEl = document.getElementById('articleReaderSheet');
const articleReaderBackdropEl = document.getElementById('articleReaderBackdrop');
const articleReaderCloseBtn = document.getElementById('articleReaderCloseBtn');
const articleReaderImgEl = document.getElementById('articleReaderImg');
const articleReaderTagEl = document.getElementById('articleReaderTag');
const articleReaderTitleEl = document.getElementById('articleReaderTitle');
const articleReaderReadTimeEl = document.getElementById('articleReaderReadTime');
const articleReaderContentEl = document.getElementById('articleReaderContent');

function renderArticleReaderBlock(block) {
  if (block.type === 'h2') return `<h2>${escapeHtml(block.text)}</h2>`;
  if (block.type === 'h3') return `<h3>${escapeHtml(block.text)}</h3>`;
  if (block.type === 'bullets') return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return `<p>${escapeHtml(block.text)}</p>`;
}

function openArticleReader(article) {
  const entry = ARTICLES_DB.find((a) => a.id === article.id);
  articleReaderImgEl.src = article.img || '';
  articleReaderImgEl.alt = article.title;
  articleReaderTagEl.classList.toggle('hidden', !article.rd);
  articleReaderTitleEl.textContent = article.title;
  articleReaderReadTimeEl.classList.toggle('hidden', !article.readTime);
  articleReaderReadTimeEl.textContent = article.readTime || '';
  articleReaderContentEl.innerHTML = entry ? entry.blocks.map(renderArticleReaderBlock).join('') : `<p>${escapeHtml(article.desc)}</p>`;
  articleReaderSheetEl.scrollTop = 0;

  articleReaderModal.classList.remove('hidden');
  void articleReaderSheetEl.offsetHeight;
  requestAnimationFrame(() => articleReaderModal.classList.add('open'));
}

function closeArticleReader() {
  if (articleReaderModal.classList.contains('hidden')) return;
  articleReaderModal.classList.remove('open');
  const onEnd = (e) => {
    if (e.target !== articleReaderSheetEl || e.propertyName !== 'transform') return;
    articleReaderSheetEl.removeEventListener('transitionend', onEnd);
    articleReaderModal.classList.add('hidden');
  };
  articleReaderSheetEl.addEventListener('transitionend', onEnd);
}
articleReaderCloseBtn.addEventListener('click', closeArticleReader);
articleReaderBackdropEl.addEventListener('click', closeArticleReader);

// ---------- Friends Network Directory ----------
const friendsView = document.getElementById('friendsView');
const friendsBackBtn = document.getElementById('friendsBackBtn');
const friendsAddBtn = document.getElementById('friendsAddBtn');
const friendsListEl = document.getElementById('friendsList');
const friendsSubnavEl = document.getElementById('friendsSubnav');
const friendsEmptyStateEl = document.getElementById('friendsEmptyState');
const friendsEmptyAddBtn = document.getElementById('friendsEmptyAddBtn');
const friendsPromoLearnMore = document.getElementById('friendsPromoLearnMore');

const FRIENDS = [];

const FRIEND_REQUESTS = [
  { id: 101, name: 'Elena Vasquez', avatar: '👩', mutual: 3 },
  { id: 102, name: 'Tariq Hassan', avatar: '🧔', mutual: 1 }
];

let activeFriendsTab = 'all';

function renderFriendsList() {
  if (activeFriendsTab === 'requests') {
    friendsEmptyStateEl.classList.add('hidden');
    friendsListEl.classList.remove('hidden');
    friendsListEl.innerHTML = FRIEND_REQUESTS.length
      ? FRIEND_REQUESTS.map(
          (r) => `
            <div class="friend-request-row" data-request-id="${r.id}">
              <span class="friend-avatar-wrap">
                <span class="friend-avatar" aria-hidden="true">${r.avatar}</span>
              </span>
              <div class="friend-identity">
                <span class="friend-name">${escapeHtml(r.name)}</span>
                <span class="friend-streak">${r.mutual} mutual friend${r.mutual === 1 ? '' : 's'}</span>
              </div>
              <div class="friend-request-actions">
                <button type="button" class="friend-request-accept-btn" data-action="accept">Accept</button>
                <button type="button" class="friend-request-decline-btn" data-action="decline">Decline</button>
              </div>
            </div>
          `
        ).join('')
      : `<div class="friends-empty-state"><p class="friends-empty-text">No pending friend requests</p></div>`;
    return;
  }

  const isEmpty = FRIENDS.length === 0;
  friendsEmptyStateEl.classList.toggle('hidden', !isEmpty);
  friendsListEl.classList.toggle('hidden', isEmpty);
  friendsListEl.innerHTML = FRIENDS.map(
    (f) => `
      <div class="friend-row" data-friend-id="${f.id}">
        <span class="friend-avatar-wrap">
          <span class="friend-avatar" aria-hidden="true">${f.avatar}</span>
          <span class="friend-active-dot ${f.active ? 'active' : ''}"></span>
        </span>
        <div class="friend-identity">
          <span class="friend-name">${escapeHtml(f.name)}</span>
          <span class="friend-streak">🔥 ${f.streak}-Day Streak</span>
        </div>
        <div class="friend-actions">
          <button type="button" class="icon-btn friend-action-btn" data-action="dm" aria-label="Message ${escapeHtml(f.name)}">✉️</button>
          <button type="button" class="icon-btn friend-action-btn" data-action="diary" aria-label="View ${escapeHtml(f.name)}'s diary">📖</button>
        </div>
      </div>
    `
  ).join('');
}

friendsListEl.addEventListener('click', (e) => {
  const requestRow = e.target.closest('.friend-request-row');
  if (requestRow) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const request = FRIEND_REQUESTS.find((r) => r.id === Number(requestRow.dataset.requestId));
    if (!request || !action) return;
    const idx = FRIEND_REQUESTS.indexOf(request);
    FRIEND_REQUESTS.splice(idx, 1);
    if (action === 'accept') {
      FRIENDS.push({ id: request.id, name: request.name, avatar: request.avatar, active: true, streak: 0 });
      showToast(`You and ${request.name} are now friends`);
    } else {
      showToast('Friend request declined');
    }
    renderFriendsList();
    return;
  }
  const btn = e.target.closest('.friend-action-btn');
  if (!btn) return;
  const row = btn.closest('.friend-row');
  const friend = FRIENDS.find((f) => f.id === Number(row.dataset.friendId));
  if (!friend) return;
  if (btn.dataset.action === 'dm') {
    openMessageThreadWithFriend(friend);
  } else {
    showToast(`${friend.name}'s diary is private`);
  }
});

friendsSubnavEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  activeFriendsTab = btn.dataset.friendsTab;
  friendsSubnavEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderFriendsList();
});

friendsAddBtn.addEventListener('click', () => showToast('Friend request sent'));
friendsEmptyAddBtn.addEventListener('click', () => showToast('Friend request sent'));
friendsPromoLearnMore.addEventListener('click', (e) => {
  e.preventDefault();
  showToast('Diet with friends is coming soon');
});

function openFriendsView() {
  renderFriendsList();
  openSubView(friendsView);
}
friendsBackBtn.addEventListener('click', () => closeSubView(friendsView));

// ---------- Messages Inbox ----------
const messagesView = document.getElementById('messagesView');
const messagesBackBtn = document.getElementById('messagesBackBtn');
const messagesSearchInput = document.getElementById('messagesSearchInput');
const messageThreadListEl = document.getElementById('messageThreadList');
const messageThreadView = document.getElementById('messageThreadView');
const messageThreadBackBtn = document.getElementById('messageThreadBackBtn');
const messageThreadTitleEl = document.getElementById('messageThreadTitle');
const chatBubblesEl = document.getElementById('chatBubbles');
const chatInputForm = document.getElementById('chatInputForm');
const chatInput = document.getElementById('chatInput');
const moreMessagesBadgeEl = document.getElementById('moreMessagesBadge');
const messagesSubnavEl = document.getElementById('messagesSubnav');
let activeMessagesTab = 'inbox';

// Starts empty — the registration welcome message (and any friend DMs) are
// merged in by loadMessages() below, which pulls the real backend inbox.
const MESSAGE_THREADS = [];
let activeThreadId = null;

function updateMessagesBadge() {
  const totalUnread = MESSAGE_THREADS.reduce((sum, t) => sum + t.unread, 0);
  moreMessagesBadgeEl.textContent = String(totalUnread);
  moreMessagesBadgeEl.classList.toggle('hidden', totalUnread === 0);
}

// Inbox tab: one row per thread, previewing its most recent message —
// covers both friend DMs and system notes (e.g. the welcome message).
function renderInboxRows(query) {
  const filtered = query ? MESSAGE_THREADS.filter((t) => t.name.toLowerCase().includes(query)) : MESSAGE_THREADS;
  return filtered
    .map((t) => {
      const last = t.messages[t.messages.length - 1];
      return `
        <div class="message-thread-row" data-thread-id="${t.id}">
          <span class="message-thread-avatar" aria-hidden="true">${t.avatar}</span>
          <div class="message-thread-meta">
            <div class="message-thread-top-line">
              <span class="message-thread-name">${escapeHtml(t.name)}</span>
              <span class="message-thread-time">${last ? last.time : ''}</span>
            </div>
            <div class="message-thread-snippet-row">
              <span class="message-thread-snippet ${t.unread > 0 ? 'unread' : ''}">${last ? escapeHtml(last.text) : ''}</span>
              ${t.unread > 0 ? `<span class="message-thread-badge">${t.unread}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Sent tab: every outgoing message across every thread, newest first — each
// row previews the message text along with who it was sent to.
function renderSentRows(query) {
  const sent = [];
  for (const t of MESSAGE_THREADS) {
    if (query && !t.name.toLowerCase().includes(query)) continue;
    for (const m of t.messages) {
      if (m.from === 'me') sent.push({ thread: t, message: m });
    }
  }
  sent.reverse();
  if (!sent.length) return `<p class="friends-empty-text" style="padding: 24px 4px;">You haven't sent any messages yet</p>`;
  return sent
    .map(
      ({ thread, message }) => `
        <div class="message-thread-row" data-thread-id="${thread.id}">
          <span class="message-thread-avatar" aria-hidden="true">${thread.avatar}</span>
          <div class="message-thread-meta">
            <div class="message-thread-top-line">
              <span class="message-thread-name">${escapeHtml(thread.name)}</span>
              <span class="message-thread-time">${message.time}</span>
            </div>
            <div class="message-thread-snippet-row">
              <span class="message-thread-snippet">${escapeHtml(message.text)}</span>
            </div>
          </div>
        </div>
      `
    )
    .join('');
}

function renderMessageThreadList() {
  const query = messagesSearchInput.value.trim().toLowerCase();
  messageThreadListEl.innerHTML = activeMessagesTab === 'sent' ? renderSentRows(query) : renderInboxRows(query);
}

messagesSearchInput.addEventListener('input', renderMessageThreadList);

messagesSubnavEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.progress-subnav-btn');
  if (!btn) return;
  activeMessagesTab = btn.dataset.messageTab;
  messagesSubnavEl.querySelectorAll('.progress-subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderMessageThreadList();
});

messageThreadListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.message-thread-row');
  if (!row) return;
  const thread = MESSAGE_THREADS.find((t) => String(t.id) === row.dataset.threadId);
  if (thread) openMessageThread(thread);
});

function renderChatBubbles(thread) {
  chatBubblesEl.innerHTML = thread.messages
    .map(
      (m) => `
        <div class="chat-bubble ${m.from === 'me' ? 'outgoing' : 'incoming'}">
          ${escapeHtml(m.text)}
          <span class="chat-bubble-time">${m.time}</span>
        </div>
      `
    )
    .join('');
  chatBubblesEl.scrollTop = chatBubblesEl.scrollHeight;
}

function openMessageThread(thread) {
  activeThreadId = thread.id;
  const wasUnread = thread.unread > 0;
  thread.unread = 0;
  messageThreadTitleEl.textContent = thread.name;
  // System notes (e.g. the registration welcome message) are read-only — no
  // reply box, and there's a real backend record to mark read.
  chatInputForm.classList.toggle('hidden', Boolean(thread.system));
  if (thread.system && wasUnread && thread.sourceMessageId) {
    authFetch(`${API}/messages/${thread.sourceMessageId}/read`, { method: 'PUT' }).catch(() => {});
  }
  renderChatBubbles(thread);
  renderMessageThreadList();
  updateMessagesBadge();
  openSubView(messageThreadView);
}

function openMessageThreadWithFriend(friend) {
  let thread = MESSAGE_THREADS.find((t) => t.name === friend.name);
  if (!thread) {
    thread = { id: MESSAGE_THREADS.length + 1000 + Math.floor(Math.random() * 1000), name: friend.name, avatar: friend.avatar, unread: 0, messages: [] };
    MESSAGE_THREADS.unshift(thread);
  }
  openMessageThread(thread);
}

chatInputForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || activeThreadId == null) return;
  const thread = MESSAGE_THREADS.find((t) => t.id === activeThreadId);
  if (!thread) return;
  thread.messages.push({ from: 'me', text, time: 'Just now' });
  chatInput.value = '';
  renderChatBubbles(thread);
});

// Pulls the real backend inbox (system notes like the registration welcome
// message) and merges each into MESSAGE_THREADS as a read-only thread, so it
// renders through the same row/bubble UI as friend DMs.
async function loadMessages() {
  try {
    const res = await authFetch(`${API}/messages`);
    if (!res.ok) return;
    const serverMessages = await res.json();
    for (const msg of serverMessages) {
      const threadId = `system-${msg.id}`;
      if (MESSAGE_THREADS.some((t) => t.id === threadId)) continue;
      MESSAGE_THREADS.unshift({
        id: threadId,
        name: msg.sender,
        avatar: '📣',
        unread: msg.read ? 0 : 1,
        system: true,
        sourceMessageId: msg.id,
        messages: [{ from: 'them', text: msg.body, time: new Date(msg.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }]
      });
    }
    renderMessageThreadList();
    updateMessagesBadge();
  } catch {
    // Non-critical — the Messages sub-view still works with local threads.
  }
}

function openMessagesView() {
  renderMessageThreadList();
  openSubView(messagesView);
}
messagesBackBtn.addEventListener('click', () => closeSubView(messagesView));
messageThreadBackBtn.addEventListener('click', () => closeSubView(messageThreadView));
updateMessagesBadge();

// ---------- Privacy Center ----------
const privacyView = document.getElementById('privacyView');
const privacyBackBtn = document.getElementById('privacyBackBtn');
const privacyProfileVisibilitySwitch = document.getElementById('privacyProfileVisibilitySwitch');
const privacyAdvertisingSwitch = document.getElementById('privacyAdvertisingSwitch');
const privacyDirectMessagingSwitch = document.getElementById('privacyDirectMessagingSwitch');
const privacyCrashReportsSwitch = document.getElementById('privacyCrashReportsSwitch');
const privacyDiarySharingSelect = document.getElementById('privacyDiarySharingSelect');
const privacyExportBtn = document.getElementById('privacyExportBtn');
const privacyDeleteAccountBtn = document.getElementById('privacyDeleteAccountBtn');

// Client-only preferences — there is no privacy-settings endpoint on the
// server, so these hold for the current session rather than persisting.
const privacyPrefs = { profileVisibility: true, advertising: false, directMessaging: true, crashReports: true, diarySharing: 'friends' };

function bindToggleSwitch(el, key) {
  el.addEventListener('click', () => {
    privacyPrefs[key] = !privacyPrefs[key];
    el.setAttribute('aria-checked', String(privacyPrefs[key]));
  });
}
bindToggleSwitch(privacyProfileVisibilitySwitch, 'profileVisibility');
bindToggleSwitch(privacyAdvertisingSwitch, 'advertising');
bindToggleSwitch(privacyDirectMessagingSwitch, 'directMessaging');
bindToggleSwitch(privacyCrashReportsSwitch, 'crashReports');

privacyDiarySharingSelect.addEventListener('change', () => {
  privacyPrefs.diarySharing = privacyDiarySharingSelect.value;
});

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function exportDataHistoryCsv() {
  if (!window.confirm('Request a full export of your data history as a CSV file?')) return;
  privacyExportBtn.disabled = true;
  privacyExportBtn.textContent = 'Preparing export…';
  try {
    const history = await loadHistory({ days: 90 });
    const rows = [['Date', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)']];
    for (const d of history?.days || []) {
      rows.push([d.date, Math.round(d.calories), Math.round(d.protein), Math.round(d.carbs), Math.round(d.fat)]);
    }
    rows.push([]);
    rows.push(['Weight Log']);
    rows.push(['Date', 'Weight (kg)']);
    for (const w of [...state.weights].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([w.date, w.weight]);
    }
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-export-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Export ready');
  } catch (err) {
    showToast('Failed to export data', true);
  } finally {
    privacyExportBtn.disabled = false;
    privacyExportBtn.textContent = 'Export Data History (CSV)';
  }
}
privacyExportBtn.addEventListener('click', exportDataHistoryCsv);

privacyDeleteAccountBtn.addEventListener('click', () => {
  const confirmed = window.confirm('This will permanently delete your account and all data. This cannot be undone. Continue?');
  if (!confirmed) return;
  showToast('Deletion request received — check your email to confirm');
});

function openPrivacyView() {
  openSubView(privacyView);
}
privacyBackBtn.addEventListener('click', () => closeSubView(privacyView));

// ---------- Help & Support ----------
const helpView = document.getElementById('helpView');
const helpBackBtn = document.getElementById('helpBackBtn');
const helpSearchInput = document.getElementById('helpSearchInput');
const helpGridEl = document.getElementById('helpGrid');
const helpFaqPanel = document.getElementById('helpFaqPanel');
const helpFaqTitleEl = document.getElementById('helpFaqTitle');
const helpFaqListEl = document.getElementById('helpFaqList');
const helpContactToggleBtn = document.getElementById('helpContactToggleBtn');
const helpContactForm = document.getElementById('helpContactForm');
const helpContactCancelBtn = document.getElementById('helpContactCancelBtn');
const helpContactSubmitBtn = document.getElementById('helpContactSubmitBtn');
const helpContactSubject = document.getElementById('helpContactSubject');
const helpContactMessage = document.getElementById('helpContactMessage');

const HELP_FAQS = {
  account: {
    title: 'Account',
    items: [
      { q: 'How do I change my email or password?', a: 'Go to More › My Profile to update your account details.' },
      { q: 'Can I use the app on multiple devices?', a: 'Yes — log in with the same account and your data syncs automatically.' }
    ]
  },
  database: {
    title: 'Database',
    items: [
      { q: 'Why is a food missing from search?', a: 'Our food database grows weekly — you can log a custom food in the meantime.' },
      { q: 'How accurate is the nutrition data?', a: 'Values are sourced from verified label data and reviewed regularly.' }
    ]
  },
  syncing: {
    title: 'Syncing',
    items: [
      { q: 'My steps aren’t showing up.', a: 'Check More › Apps & Devices to confirm your tracker is connected, then force a sync from More › Sync.' },
      { q: 'How often does data sync?', a: 'Automatically in the background, or instantly with Force Cloud Database Sync.' }
    ]
  },
  features: {
    title: 'Features',
    items: [
      { q: 'How do I set a custom macro split?', a: 'Head to More › Goals › Calorie, Carbs, Protein and Fat Goals.' },
      { q: 'Can I track intermittent fasting?', a: 'Yes, use More › Intermittent Fasting to start and end fasting windows.' }
    ]
  }
};

function renderHelpFaq(topic) {
  const data = HELP_FAQS[topic];
  if (!data) return;
  helpFaqTitleEl.textContent = data.title;
  helpFaqListEl.innerHTML = data.items
    .map((f) => `<li class="help-faq-item"><button type="button" class="help-faq-q-btn"><span class="help-faq-q">${escapeHtml(f.q)}</span><span class="help-faq-caret" aria-hidden="true">›</span></button><p class="help-faq-a">${escapeHtml(f.a)}</p></li>`)
    .join('');
  helpFaqPanel.classList.remove('hidden');
  helpGridEl.querySelectorAll('.help-card').forEach((c) => c.classList.toggle('active', c.dataset.topic === topic));
}

// Accordion — tapping a question toggles just that row's answer open/closed;
// other rows stay however the user left them.
helpFaqListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.help-faq-q-btn');
  if (!btn) return;
  btn.closest('.help-faq-item').classList.toggle('open');
});

helpGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.help-card');
  if (!card) return;
  renderHelpFaq(card.dataset.topic);
});

helpSearchInput.addEventListener('input', () => {
  const query = helpSearchInput.value.trim().toLowerCase();
  for (const [topic, data] of Object.entries(HELP_FAQS)) {
    const match = !query || data.title.toLowerCase().includes(query) || data.items.some((f) => f.q.toLowerCase().includes(query));
    const card = helpGridEl.querySelector(`.help-card[data-topic="${topic}"]`);
    if (card) card.classList.toggle('hidden', !match);
  }
});

helpContactToggleBtn.addEventListener('click', () => {
  helpContactForm.classList.remove('hidden');
  helpContactToggleBtn.classList.add('hidden');
});
helpContactCancelBtn.addEventListener('click', () => {
  helpContactForm.classList.add('hidden');
  helpContactToggleBtn.classList.remove('hidden');
});
helpContactSubmitBtn.addEventListener('click', () => {
  if (!helpContactSubject.value.trim() || !helpContactMessage.value.trim()) {
    showToast('Please fill in both fields', true);
    return;
  }
  helpContactSubject.value = '';
  helpContactMessage.value = '';
  helpContactForm.classList.add('hidden');
  helpContactToggleBtn.classList.remove('hidden');
  showToast('Support ticket submitted');
});

function openHelpView() {
  helpSearchInput.value = '';
  helpFaqPanel.classList.add('hidden');
  helpContactForm.classList.add('hidden');
  helpContactToggleBtn.classList.remove('hidden');
  helpGridEl.querySelectorAll('.help-card').forEach((c) => {
    c.classList.remove('active');
    c.classList.remove('hidden');
  });
  openSubView(helpView);
}
helpBackBtn.addEventListener('click', () => closeSubView(helpView));

// ---------- Sync Status ----------
const syncView = document.getElementById('syncView');
const syncBackBtn = document.getElementById('syncBackBtn');
const syncWheelWrapEl = document.getElementById('syncWheelWrap');
const syncTimestampEl = document.getElementById('syncTimestamp');
const syncForceBtn = document.getElementById('syncForceBtn');
const syncHardwareStatusEl = document.getElementById('syncHardwareStatus');

function formatSyncTimestamp(date) {
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  return `Last Successful Cloud Sync: ${isToday ? 'Today' : date.toLocaleDateString()} at ${time}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateSyncHardwareStatus() {
  const connectedCount = state.devices ? Object.values(state.devices).filter(Boolean).length : 0;
  syncHardwareStatusEl.textContent = connectedCount > 0 ? `${connectedCount} device${connectedCount > 1 ? 's' : ''} connected` : 'No devices';
}

async function openSyncView() {
  if (!state.lastSyncAt) state.lastSyncAt = new Date();
  syncTimestampEl.textContent = formatSyncTimestamp(state.lastSyncAt);
  syncTimestampEl.classList.remove('sync-timestamp--synced');
  openSubView(syncView);
  await loadDevices();
  updateSyncHardwareStatus();
}

syncForceBtn.addEventListener('click', async () => {
  syncWheelWrapEl.classList.add('syncing');
  syncTimestampEl.classList.remove('sync-timestamp--synced');
  syncForceBtn.disabled = true;
  try {
    // Always run the full 1.5s wheel animation even when the real requests
    // resolve faster, so the loader never flickers past too quickly to read.
    await Promise.all([loadDay(), loadWeights(), loadProfile(), loadDevices(), wait(1500)]);
    state.lastSyncAt = new Date();
    syncTimestampEl.textContent = '✅ Last Synced: Just Now';
    syncTimestampEl.classList.add('sync-timestamp--synced');
    updateSyncHardwareStatus();
    showToast('Synced');
  } catch (err) {
    showToast('Sync failed', true);
  } finally {
    syncWheelWrapEl.classList.remove('syncing');
    syncForceBtn.disabled = false;
  }
});

syncBackBtn.addEventListener('click', () => closeSubView(syncView));

// ---------- More tab (profile header, menu, body metrics, theme, logout) ----------
// Weight-loss progress = earliest logged weight minus most recent weight,
// floored at 0 for weight gain. Values are stored in kg; display converts to
// the user's chosen unit via getWeightUnit()/kgToLbs().
function computeWeightSummary() {
  if (!state.weights || state.weights.length === 0) return null;
  const chronological = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const start = chronological[0].weight;
  const current = chronological[chronological.length - 1].weight;
  return { start, current, lost: Math.max(0, start - current) };
}

function formatWeightBadge(kg) {
  const unit = getWeightUnit();
  const value = unit === 'lbs' ? kgToLbs(kg) : kg;
  return `${value.toFixed(1)} ${unit}`;
}

function formatMfpLastSync(date) {
  if (!date) return 'Last Sync: Just now';
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'Last Sync: Just now';
  if (diffMin < 60) return `Last Sync: ${diffMin} min ago`;
  return `Last Sync: ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

async function openMoreTab() {
  profileUsernameEl.textContent = state.user?.username || '—';
  mfpLastSyncEl.textContent = formatMfpLastSync(state.lastSyncAt);

  const summary = computeWeightSummary();
  mfpMetricCurrentEl.textContent = summary ? formatWeightBadge(summary.current) : '— kg';
  mfpMetricStartEl.textContent = summary ? formatWeightBadge(summary.start) : '— kg';
  mfpMetricLostEl.textContent = summary ? formatWeightBadge(summary.lost) : '— kg';
}

moreProfileHeaderCard.addEventListener('click', () => openProfileDetailsView());
moreProfileHeaderCard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileDetailsView(); }
});

// ---------- Profile Details sub-view (tap the MFP-style profile card) ----------
// Purely a client-side display profile — independent from the account
// username/email used for auth (see Email Settings, which already treats
// that as read-only) — so every row here reads/writes one localStorage blob.
const PROFILE_DETAILS_KEY = 'pure_macros_profile_details';
const TIME_ZONE_OPTIONS = ['GMT', 'CET', 'EST', 'CST', 'MST', 'PST', 'IST', 'AEST'];
const UNITS_OPTIONS = ['st, ft/in, cal, mi, oz', 'kg, cm, kJ, km, g'];
const PROFILE_DETAILS_FIELDS = {
  username: { label: 'User Name', type: 'text', placeholder: 'username123', default: 'username123' },
  profilePhoto: { label: 'Profile Photo', type: 'text', placeholder: 'Paste an image URL', default: '' },
  height: { label: 'Height', type: 'text', placeholder: '5 ft, 10 in', default: '5 ft, 10 in' },
  sex: { label: 'Sex', type: 'select', options: ['Male', 'Female', 'Other'], default: 'Male' },
  dob: { label: 'Date of Birth', type: 'date', default: '2000-01-01' },
  location: { label: 'Location', type: 'text', placeholder: 'United Kingdom', default: 'United Kingdom' },
  zipCode: { label: 'Zip/Postal Code', type: 'text', placeholder: '90210', default: '90210' },
  timeZone: { label: 'Time Zone', type: 'select', options: TIME_ZONE_OPTIONS, default: 'GMT' },
  email: { label: 'Email Address', type: 'text', placeholder: 'user@example.com', default: 'user@example.com' },
  units: { label: 'Units', type: 'select', options: UNITS_OPTIONS, default: 'st, ft/in, cal, mi, oz' }
};

function getProfileDetails() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_DETAILS_KEY)) || {};
  } catch {
    return {};
  }
}

// Age comes in as a whole-year count with no month/day, so a birthdate can
// only be approximated — anchoring to Jan 1 of (current year - age) is the
// same convention onboarding already uses for the age math elsewhere.
function computeDobFromAge(ageYears) {
  const year = new Date().getFullYear() - ageYears;
  return `${year}-01-01`;
}

function formatHeightForUnits(cm, unitsValue) {
  if (unitsValue === UNITS_OPTIONS[1]) return `${Math.round(cm * 10) / 10} cm`;
  const { ft, inch } = cmToFtIn(cm);
  return `${ft} ft, ${inch} in`;
}

// Registration (the Coach onboarding wizard) only collects height/weight/age,
// not a full Personal Details profile. Once it succeeds, backfill the dob/
// height rows from that data — but only ones the user hasn't already set by
// hand in Personal Details, so a later edit there is never clobbered.
function seedProfileDetailsFromOnboarding(payload) {
  const details = getProfileDetails();
  let changed = false;
  if (!details.dob && payload.ageYears) {
    details.dob = computeDobFromAge(payload.ageYears);
    changed = true;
  }
  if (!details.height && payload.heightCm) {
    details.height = formatHeightForUnits(payload.heightCm, details.units || PROFILE_DETAILS_FIELDS.units.default);
    changed = true;
  }
  if (!changed) return;
  localStorage.setItem(PROFILE_DETAILS_KEY, JSON.stringify(details));
  renderProfileDetailsList();
}

// 'YYYY-MM-DD' (the <input type="date"> storage format) -> 'DD Mon YYYY'
// display text. Parsed manually so the day never shifts across timezones.
function formatDobDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
}

// The uploaded avatar lives in its own localStorage key (a data URL, so it
// can be large) rather than inside the PROFILE_DETAILS_KEY blob, keeping the
// text-field profile object small and fast to JSON.parse on every render.
const USER_PROFILE_AVATAR_KEY = 'user_profile_avatar';
const profilePhotoFileInput = document.getElementById('profilePhotoFileInput');

// Every avatar placeholder across the app (profile header, hero card,
// community composer, ...) is tagged with [data-avatar-slot] so one upload
// updates all of them immediately instead of only the screen it was set from.
function refreshAllAvatars() {
  const dataUrl = localStorage.getItem(USER_PROFILE_AVATAR_KEY);
  document.querySelectorAll('[data-avatar-slot]').forEach((el) => {
    if (dataUrl) {
      el.style.backgroundImage = `url("${dataUrl}")`;
      el.classList.add('has-photo');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-photo');
    }
  });
}

profilePhotoFileInput.addEventListener('change', () => {
  const file = profilePhotoFileInput.files && profilePhotoFileInput.files[0];
  profilePhotoFileInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(USER_PROFILE_AVATAR_KEY, reader.result);
    refreshAllAvatars();
    renderProfileDetailsList();
    showToast('Profile photo updated');
  };
  reader.onerror = () => showToast('Failed to read image', true);
  reader.readAsDataURL(file);
});
refreshAllAvatars();

function renderProfileDetailsList() {
  const details = getProfileDetails();
  document.getElementById('profileDetailsUsername').textContent = details.username || state.user?.username || PROFILE_DETAILS_FIELDS.username.default;
  document.getElementById('profileDetailsProfilePhoto').textContent = localStorage.getItem(USER_PROFILE_AVATAR_KEY) ? '📷 Photo Set' : '👤 Add Photo';
  document.getElementById('profileDetailsHeight').textContent = details.height || PROFILE_DETAILS_FIELDS.height.default;
  document.getElementById('profileDetailsSex').textContent = details.sex || PROFILE_DETAILS_FIELDS.sex.default;
  document.getElementById('profileDetailsDob').textContent = formatDobDisplay(details.dob || PROFILE_DETAILS_FIELDS.dob.default);
  document.getElementById('profileDetailsLocation').textContent = details.location || PROFILE_DETAILS_FIELDS.location.default;
  document.getElementById('profileDetailsZipCode').textContent = details.zipCode || PROFILE_DETAILS_FIELDS.zipCode.default;
  document.getElementById('profileDetailsTimeZone').textContent = details.timeZone || PROFILE_DETAILS_FIELDS.timeZone.default;
  document.getElementById('profileDetailsEmail').textContent = details.email || PROFILE_DETAILS_FIELDS.email.default;
  document.getElementById('profileDetailsUnits').textContent = details.units || PROFILE_DETAILS_FIELDS.units.default;
}

// History reference for smart back-navigation: records which screen opened
// Personal Details so the back arrow can return there directly instead of
// always falling back to one hardcoded screen — 'settings' when opened from
// Settings > Profile Settings, 'profile' when opened from My Profile > Edit Profile.
let profileDetailsOrigin = 'profile';

function openProfileDetailsView(origin) {
  profileDetailsOrigin = origin || profileDetailsOrigin || 'profile';
  renderProfileDetailsList();
  openSubView(profileDetailsView);
}
profileDetailsBackBtn.addEventListener('click', () => {
  closeSubView(profileDetailsView);
  if (profileDetailsOrigin === 'settings') {
    if (!settingsView.classList.contains('open')) openSettingsView();
  } else if (!profileView.classList.contains('open')) {
    openProfileView();
  }
});

let activeProfileField = null;

function openProfileFieldSheet(field) {
  const config = PROFILE_DETAILS_FIELDS[field];
  if (!config) return;
  activeProfileField = field;
  const details = getProfileDetails();
  profileFieldTitleEl.textContent = config.label;

  if (config.type === 'select') {
    profileFieldSelectInput.innerHTML = config.options
      .map((opt) => `<option value="${opt}">${opt}</option>`)
      .join('');
    profileFieldSelectInput.value = details[field] || config.default || config.options[0];
    profileFieldSelectInput.classList.remove('hidden');
    profileFieldTextInput.classList.add('hidden');
  } else {
    profileFieldTextInput.type = config.type === 'date' ? 'date' : 'text';
    profileFieldTextInput.placeholder = config.placeholder || '';
    profileFieldTextInput.value = details[field] || (config.type === 'date' ? config.default : '');
    profileFieldTextInput.classList.remove('hidden');
    profileFieldSelectInput.classList.add('hidden');
  }

  profileFieldSheet.classList.add('open');
  if (config.type !== 'select') profileFieldTextInput.focus();
}

function closeProfileFieldSheet() {
  profileFieldSheet.classList.remove('open');
  activeProfileField = null;
}
profileFieldCloseBtn.addEventListener('click', closeProfileFieldSheet);
profileFieldSheetBackdrop.addEventListener('click', closeProfileFieldSheet);

// The Personal Details "Units" row is the one user-facing control meant to
// govern every unit-aware surface in the app, but weight logs/chart, height
// fields, and workout weights each keep their own independent preference key
// (older, narrower toggles that predate this row). Saving "Units" here fans
// out to all three so those linked components recalibrate immediately
// instead of silently drifting out of sync with what the profile now says.
function applyProfileUnitsPreference(unitsValue) {
  const isMetric = unitsValue === UNITS_OPTIONS[1];
  const weightUnit = isMetric ? 'kg' : 'lbs';
  const heightUnit = isMetric ? 'cm' : 'ftin';
  const systemPref = isMetric ? 'metric' : 'imperial';

  if (getWeightUnit() !== weightUnit) {
    const currentTargetKg = readTargetWeightKgFromField();
    localStorage.setItem(WEIGHT_UNIT_KEY, weightUnit);
    applyWeightUnitUI();
    writeTargetWeightFieldFromKg(currentTargetKg);
  }
  if (getHeightUnit() !== heightUnit) {
    const currentCm = readHeightCmFromFields();
    localStorage.setItem(HEIGHT_UNIT_KEY, heightUnit);
    applyHeightUnitUI();
    writeHeightFieldsFromCm(currentCm);
  }
  if (userUnitPreference !== systemPref) setUnitSystemPreference(systemPref);
}

profileFieldSaveBtn.addEventListener('click', () => {
  if (!activeProfileField) return;
  const config = PROFILE_DETAILS_FIELDS[activeProfileField];
  const value = config.type === 'select' ? profileFieldSelectInput.value : profileFieldTextInput.value.trim();
  const details = getProfileDetails();
  if (value) details[activeProfileField] = value;
  else delete details[activeProfileField];
  localStorage.setItem(PROFILE_DETAILS_KEY, JSON.stringify(details));
  if (activeProfileField === 'units' && value) applyProfileUnitsPreference(value);
  renderProfileDetailsList();
  closeProfileFieldSheet();
});

profileDetailsListEl.addEventListener('click', (e) => {
  const navRow = e.target.closest('[data-profile-nav]');
  if (navRow) {
    const action = MORE_MENU_ACTIONS[navRow.dataset.profileNav];
    if (action) action();
    return;
  }
  const row = e.target.closest('[data-profile-field]');
  if (!row) return;
  if (row.dataset.profileField === 'profilePhoto') {
    profilePhotoFileInput.click();
    return;
  }
  openProfileFieldSheet(row.dataset.profileField);
});

// Menu rows that map onto functionality already elsewhere in the app; every
// other row is a placeholder for a not-yet-built feature and just toasts.
const MORE_MENU_ACTIONS = {
  profile: () => openProfileView(),
  goals: () => openGoalsView(),
  workouts: () => openWorkoutRoutinesView(),
  'weight-measurements': () => openWeightMeasurementsView(),
  fasting: () => openFastingView(),
  nutrition: () => openNutritionAnalyticsView(),
  'my-meals': () => openMrfView(),
  steps: () => openStepsHubView(),
  sleep: () => openSleepTrackingView(),
  reminders: () => openRemindersView(),
  'recipe-discovery': () => openDiscoveryView(),
  'apps-devices': () => openAppsDevicesView(),
  'weekly-report': () => openWeeklyReportView(),
  community: () => (state.settings?.communityConnected ? openCommunityView() : openCommunitySubview()),
  learn: () => openLearnView(),
  friends: () => openFriendsView(),
  messages: () => openMessagesView(),
  settings: () => openSettingsView(),
  privacy: () => openPrivacyView(),
  help: () => openHelpView(),
  sync: () => openSyncView()
};

moreMenuListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.more-menu-item');
  if (!item) return;
  const action = MORE_MENU_ACTIONS[item.dataset.menuKey];
  if (action) action();
  else showToast('Coming soon');
});

async function handleProfileSubmit(e) {
  e.preventDefault();
  profileError.textContent = '';

  const heightCm = readHeightCmFromFields();
  const targetWeightKg = readTargetWeightKgFromField();
  const payload = {
    calorieGoal: state.settings.calorieGoal,
    macroGoals: state.settings.macroGoals,
    heightCm,
    targetWeightKg
  };

  try {
    const res = await authFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save profile');
    state.settings = data;
    showToast('Profile updated');
  } catch (err) {
    profileError.textContent = err.message;
  }
}

// ---------- Utilities ----------
let toastTimer;
function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

let iosTopToastTimer;
function showIosTopToast(message, icon = '✓') {
  iosTopToastIconEl.textContent = icon;
  iosTopToastTextEl.textContent = message;
  iosTopToastEl.classList.add('show');
  clearTimeout(iosTopToastTimer);
  iosTopToastTimer = setTimeout(() => iosTopToastEl.classList.remove('show'), 2800);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
