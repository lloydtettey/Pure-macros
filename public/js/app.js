const API = '/api';
const CUSTOM_FOOD_ID = '__custom__';
// Foods surfaced by the live universal search (/api/foods/search) aren't part
// of the local FOOD_DB reference list, so they're cached here by id — lets
// resolveSelectedFood() and the quick-add flow treat them like any other
// selectable food while still logging them server-side as a custom food.
const externalFoodCache = new Map();
let globalFoodSearchTimer = null;
const AUTH_TOKEN_KEY = 'macrogram_token';
const THEME_KEY = 'pure_macros_theme';
const WEIGHT_UNIT_KEY = 'pure_macros_weight_unit';
const HEIGHT_UNIT_KEY = 'pure_macros_height_unit';

const RING_CIRCUMFERENCE = 2 * Math.PI * 70;

const TAB_LABELS = { today: 'Today', plan: 'Plan', progress: 'Progress', more: 'More' };

const state = {
  date: todayStr(),
  settings: null,
  entries: [],
  foods: [],
  water: 0,
  waterOz: 0,
  weights: [],
  exercise: [],
  steps: [],
  sleep: [],
  history: null,
  user: null,
  mealPlan: null
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
let cachedStreakDays = null; // last 60 days from /history, cached for the header streak chip

const dateStripEl = document.getElementById('dateStrip');
const headerStreakValueEl = document.getElementById('headerStreakValue');
const macrosSwapBtn = document.getElementById('macrosSwapBtn');

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
const moreStreakValueEl = document.getElementById('moreStreakValue');
const moreProgressValueEl = document.getElementById('moreProgressValue');
const moreMenuListEl = document.getElementById('moreMenuList');
const settingsView = document.getElementById('settingsView');
const settingsBackBtn = document.getElementById('settingsBackBtn');
const settingsMenuListEl = document.getElementById('settingsMenuList');
const goPremiumBtn = document.getElementById('goPremiumBtn');
const themeSwitch = document.getElementById('themeSwitch');

const goalsView = document.getElementById('goalsView');
const goalsBackBtn = document.getElementById('goalsBackBtn');
const nutritionGoalsMenuListEl = document.getElementById('nutritionGoalsMenuList');
const goalsGoPremiumBtn = document.getElementById('goalsGoPremiumBtn');
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
const weightInput = document.getElementById('weightInput');
const weightError = document.getElementById('weightError');
const weightTimelineEl = document.getElementById('weightTimeline');

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
const sleepError = document.getElementById('sleepError');
const sleepTimelineEl = document.getElementById('sleepTimeline');

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
const WATER_DISPLAY_UNIT_KEY = 'pure_macros_water_unit';
const OZ_TO_ML = 29.5735;
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

// ---------- Auth ----------
function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
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

function handleSessionExpired() {
  clearToken();
  showAuthOverlay();
  showToast('Session expired — please log in again', true);
}

function showAuthOverlay() {
  appRoot.classList.remove('app-visible');
  appRoot.classList.add('hidden');
  authOverlay.classList.remove('closing');
}

function revealApp() {
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
function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isLight = theme === 'light';
  themeSwitch.setAttribute('aria-checked', String(isLight));
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

applyTheme(getStoredTheme());

themeSwitch.addEventListener('click', () => {
  setTheme(getStoredTheme() === 'light' ? 'dark' : 'light');
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

// ---------- Tabs (Today / Plan / Progress / More) ----------
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  tabViews.forEach((view) => view.classList.toggle('hidden', view.dataset.tabView !== tab));
  bottomNavBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.target === tab));
  tabTitleEl.textContent = TAB_LABELS[tab] || '';

  if (tab === 'plan') openPlanTabView();
  if (tab === 'progress') openProgressTab();
  if (tab === 'more') openMoreTab();

  requestAnimationFrame(syncFixedBarHeights);
}

bottomNavBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.target));
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

macrosSwapBtn.addEventListener('click', () => {
  macroCardMode = macroCardMode === 'percent' ? 'grams' : 'percent';
  macrosSwapBtn.classList.toggle('active', macroCardMode === 'grams');
  renderMacros();
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

  gramsInput.addEventListener('input', () => updateFoodPreview(card));
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

function openMacroGoalsModal() {
  macroGoalsError.textContent = '';
  const settings = state.settings || {};
  macroGoalCaloriesSlider.value = settings.calorieGoal ?? 2200;
  macroGoalProteinSlider.value = settings.macroGoals?.protein ?? 150;
  macroGoalCarbsSlider.value = settings.macroGoals?.carbs ?? 250;
  macroGoalFatSlider.value = settings.macroGoals?.fat ?? 70;
  updateMacroGoalSliderLabels();
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
  logout: () => handleLogout()
};

settingsMenuListEl.addEventListener('click', (e) => {
  if (e.target.closest('.theme-switch')) return;
  const item = e.target.closest('.more-menu-item');
  if (!item) return;
  if (item.dataset.menuKey === 'app-appearance') {
    themeSwitch.click();
    return;
  }
  const action = SETTINGS_MENU_ACTIONS[item.dataset.menuKey];
  if (action) action();
  else showToast('Coming soon');
});

goPremiumBtn.addEventListener('click', () => showToast('Coming soon'));

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
  goalsView.classList.add('open');
}

function closeGoalsView() {
  goalsView.classList.remove('open');
}

goalsBackBtn.addEventListener('click', closeGoalsView);

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

goalsGoPremiumBtn.addEventListener('click', () => showToast('Coming soon'));

// ---------- Global "+" Food Logging Overlay ----------
function openLogOverlay() {
  logQuickAddError.textContent = '';
  logQuickAddForm.reset();
  logQuickAddForm.classList.add('hidden');
  logSearchInput.value = '';
  switchLogSubtab('history');
  refreshLogOverlayLists();
  logOverlay.classList.add('open');
}

function closeLogOverlay() {
  logOverlay.classList.remove('open');
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
  showToast('Barcode scanning is coming soon');
});
document.getElementById('logFeatureVoice').addEventListener('click', () => {
  showToast('Voice logging is coming soon');
});
document.getElementById('logFeatureMealScan').addEventListener('click', () => {
  logMealScanFileInput.click();
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
  logQuickAddForm.classList.toggle('hidden');
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
  loadStreak();
  loadPlanPreferences();
}

(async function bootstrapAuth() {
  const token = getToken();
  if (!token) return; // auth overlay is the default visible state
  try {
    const res = await authFetch(`${API}/auth/me`);
    if (!res.ok) throw new Error('invalid session');
    const data = await res.json();
    state.user = data;
    revealApp();
    initApp();
    if (!data.onboarded) openCoachWizard({ mode: 'onboarding' });
  } catch {
    clearToken();
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

function readCustomFood(card) {
  return {
    name: card.querySelector('.f-custom-name').value.trim(),
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

async function loadDay() {
  try {
    const res = await authFetch(`${API}/day?date=${state.date}`);
    if (!res.ok) throw new Error('Failed to load day data');
    const data = await res.json();
    state.settings = data.settings;
    state.entries = data.entries;
    render();
  } catch (err) {
    showToast(err.message, true);
  }
  await loadWater();
  await loadExercise();
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
  // getDay() is 0 (Sun) - 6 (Sat); convert to a Monday-first offset so the
  // ribbon always spans Mon..Sun of the current week, matching the M T W T F S S layout.
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
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
    return;
  }
  for (const w of state.weights) {
    weightTimelineEl.appendChild(buildWeightEntry(w));
  }
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
// the request goes out, and results are converted back for display.
async function handleWeightSubmit(e) {
  e.preventDefault();
  weightError.textContent = '';
  const entered = Number(weightInput.value);
  if (!entered || entered <= 0) {
    weightError.textContent = 'Enter a valid weight';
    return;
  }
  const weightKg = getWeightUnit() === 'lbs' ? lbsToKg(entered) : entered;
  try {
    const res = await authFetch(`${API}/weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, weight: Math.round(weightKg * 10) / 10 })
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

function openAddWaterScreen() {
  addWaterPendingOz = 0;
  renderAddWaterAmount();
  addWaterScreen.classList.add('open');
}
function closeAddWaterScreen() {
  addWaterScreen.classList.remove('open');
}

addWaterBackBtn.addEventListener('click', closeAddWaterScreen);

document.querySelectorAll('.water-quickadd-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    addWaterPendingOz += Number(btn.dataset.oz);
    renderAddWaterAmount();
  });
});

addWaterAmountInput.addEventListener('input', () => {
  const unit = getWaterDisplayUnit();
  const typed = Number(addWaterAmountInput.value) || 0;
  addWaterPendingOz = Math.max(0, displayUnitToOz(typed, unit));
  updateWaterFillBar();
});

addWaterChangeUnitBtn.addEventListener('click', () => {
  localStorage.setItem(WATER_DISPLAY_UNIT_KEY, getWaterDisplayUnit() === 'oz' ? 'ml' : 'oz');
  renderAddWaterAmount();
});

addWaterSaveBtn.addEventListener('click', async () => {
  if (addWaterPendingOz <= 0) {
    closeAddWaterScreen();
    return;
  }
  try {
    const res = await authFetch(`${API}/water`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, ounces: Math.round((state.waterOz + addWaterPendingOz) * 10) / 10 })
    });
    if (!res.ok) throw new Error('Failed to save water log');
    const data = await res.json();
    state.water = data.filled;
    state.waterOz = data.ounces;
    renderWater();
    closeAddWaterScreen();
    showToast(`Added ${Math.round(addWaterPendingOz)} oz water`);
  } catch (err) {
    showToast(err.message, true);
  }
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
  renderMacroHistoryChart(history);
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

// Combined Protein/Carbs/Fat history as one hand-rolled SVG line chart: days
// along the bottom, grams along a left-side axis column (mirrors the
// .scaled-bar-chart-axis pattern already used for the Steps monthly chart).
function renderMacroHistoryChart(history) {
  const days = history.days || [];
  const axisEl = document.getElementById('macroHistoryAxis');
  const svgEl = document.getElementById('macroHistorySvg');
  const xLabelsEl = document.getElementById('macroHistoryXLabels');

  axisEl.innerHTML = '';
  xLabelsEl.innerHTML = '';
  svgEl.innerHTML = '';
  if (days.length === 0) return;

  const maxVal = Math.max(1, ...days.flatMap((d) => [d.protein, d.carbs, d.fat]));
  const ceiling = niceCeil(maxVal);

  for (let i = 4; i >= 0; i--) {
    const span = document.createElement('span');
    span.textContent = Math.round((ceiling / 4) * i);
    axisEl.appendChild(span);
  }

  const width = 300;
  const height = 140;
  const padY = 6;
  const plotHeight = height - padY * 2;
  const stepX = days.length > 1 ? width / (days.length - 1) : 0;

  const toPoints = (key) =>
    days
      .map((d, i) => {
        const x = days.length > 1 ? i * stepX : width / 2;
        const y = padY + plotHeight - (Math.min(d[key], ceiling) / ceiling) * plotHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const gridLines = [0, 1, 2, 3, 4]
    .map((i) => {
      const y = (padY + (plotHeight / 4) * i).toFixed(1);
      return `<line class="macro-history-grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}" />`;
    })
    .join('');

  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svgEl.innerHTML = `
    ${gridLines}
    <polyline class="macro-history-line protein" points="${toPoints('protein')}" />
    <polyline class="macro-history-line carbs" points="${toPoints('carbs')}" />
    <polyline class="macro-history-line fat" points="${toPoints('fat')}" />
  `;

  const labelCount = Math.min(5, days.length);
  const labelIndices = new Set();
  for (let i = 0; i < labelCount; i++) {
    labelIndices.add(Math.round((i * (days.length - 1)) / Math.max(labelCount - 1, 1)));
  }
  for (const idx of [...labelIndices].sort((a, b) => a - b)) {
    const span = document.createElement('span');
    span.textContent = formatChartLabel(days[idx].date, days.length);
    xLabelsEl.appendChild(span);
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
  li.innerHTML = `
    <span class="weight-date">${formatDateLabel(entry.date)}</span>
    <span class="weight-value">${entry.totalHours}h asleep</span>
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
  if ([awakeHours, remHours, coreHours, deepHours].some((v) => Number.isNaN(v) || v < 0)) {
    sleepError.textContent = 'Enter valid, non-negative hours for each phase';
    return;
  }
  if (awakeHours + remHours + coreHours + deepHours > 24) {
    sleepError.textContent = 'Sleep phase hours cannot exceed 24 total';
    return;
  }
  try {
    const res = await authFetch(`${API}/sleep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, awakeHours, remHours, coreHours, deepHours })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to log sleep');
    sleepAwakeInput.value = '';
    sleepRemInput.value = '';
    sleepCoreInput.value = '';
    sleepDeepInput.value = '';
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
  renderCalorieBar();
  renderMacros();
  renderMeals();
  refreshLogOverlayLists();
}

function renderCalorieBar() {
  const totals = computeTotals(state.entries);
  const goal = state.settings.calorieGoal;
  const consumed = Math.round(totals.calories);
  const burned = (state.exercise || []).reduce((sum, e) => sum + e.caloriesBurned, 0);
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
  const { protein, carbs, fat } = state.settings.macroGoals;
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
}

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

// Fetched once per session (or session-restore) since a logging streak only
// ever changes at most once per day; refreshed live below without refetching
// by substituting today's cached day with the current in-memory totals.
async function loadStreak() {
  const history = await loadHistory({ days: 60 });
  cachedStreakDays = history ? history.days : null;
  updateHeaderStreak();
}

function updateHeaderStreak() {
  if (!cachedStreakDays || !state.settings) return;
  const days = [...cachedStreakDays];
  const last = days[days.length - 1];
  // Only substitute the live in-memory totals when today is the day actually
  // being viewed — state.entries holds whichever day the user is browsing,
  // and the streak must always reflect *today's* logging, not that day's.
  if (last && last.date === todayStr() && state.date === todayStr()) {
    days[days.length - 1] = { ...last, calories: computeTotals(state.entries).calories };
  }
  headerStreakValueEl.textContent = String(computeLoggingStreak(days));
}

function renderMeals() {
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

function buildFoodItem(item) {
  const li = document.createElement('li');
  li.className = 'food-item';
  // .food-info is a column flexbox, so this sibling span (rather than being
  // nested inside .food-name) naturally lands on its own line directly
  // beneath the food name instead of trailing it inline.
  const gramsLine = item.grams ? `<span class="food-grams">${item.grams}g</span>` : '';
  li.innerHTML = `
    <div class="food-info">
      <span class="food-name">${escapeHtml(item.name)}</span>
      ${gramsLine}
      <span class="food-macros"><span class="m-protein">P ${item.protein}g</span> · <span class="m-carbs">C ${item.carbs}g</span> · <span class="m-fat">F ${item.fat}g</span></span>
    </div>
    <div class="food-right">
      <span class="food-kcal">${item.calories} kcal</span>
      <button class="delete-btn" aria-label="Delete">✕</button>
    </div>
  `;
  li.querySelector('.delete-btn').addEventListener('click', () => deleteEntry(item.id));
  return li;
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
let planState = createEmptyPlanState();

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

pwBackBtn.addEventListener('click', () => pwGoToStep(pwCurrentStep - 1));

pwNextBtn.addEventListener('click', async () => {
  const err = validatePwStep(pwCurrentStep);
  if (err) {
    pwErrorEl.textContent = err;
    return;
  }
  if (pwCurrentStep < PW_STEP_COUNT) {
    pwGoToStep(pwCurrentStep + 1);
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
const PLAN_SAMPLE_RECIPES = [
  { name: 'Grilled Chicken & Quinoa Bowl', kcal: 420, protein: 38, carbs: 34, fat: 12 },
  { name: 'Herb-Crusted Salmon with Asparagus', kcal: 390, protein: 34, carbs: 10, fat: 22 },
  { name: 'Turkey & Sweet Potato Skillet', kcal: 410, protein: 36, carbs: 40, fat: 10 },
  { name: 'High-Protein Beef Stir-Fry', kcal: 460, protein: 42, carbs: 30, fat: 16 },
  { name: 'Cottage Cheese & Egg White Scramble', kcal: 320, protein: 40, carbs: 8, fat: 10 },
  { name: 'Greek Yogurt Protein Parfait', kcal: 300, protein: 30, carbs: 28, fat: 6 }
];

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

function renderPlanHub() {
  const prefs = state.mealPlan?.preferences || {};
  const goalLabel = PW_GOAL_LABELS[prefs.goal];
  planHubSubtitleEl.textContent = goalLabel ? `Focused on ${goalLabel} · high-protein picks` : 'High-protein picks for your goals';
  planRecipeGridEl.innerHTML = PLAN_SAMPLE_RECIPES.map((r) => `
    <div class="plan-recipe-card">
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
  `).join('');
}

function renderPlanTab() {
  const onboarded = Boolean(state.mealPlan?.onboarded);
  planEmptyStateEl.classList.toggle('hidden', onboarded);
  planHubEl.classList.toggle('hidden', !onboarded);
  if (onboarded) renderPlanHub();
}

// Entry point for the bottom-nav Plan button: renders whatever's behind the
// wizard (empty state or hub) and, per spec, immediately launches the 9-step
// questionnaire itself whenever the quiz hasn't been completed yet.
function openPlanTabView() {
  renderPlanTab();
  if (!state.mealPlan?.onboarded) openPlanWizard();
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

// ---------- More tab (profile header, menu, body metrics, theme, logout) ----------
// Logging streak = consecutive days with logged calories, counted backward
// from the most recent day in a 60-day history window.
function computeLoggingStreak(days) {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].calories > 0) streak++;
    else break;
  }
  return streak;
}

// Weight-loss progress (always shown in lbs, matching the header spec)
// = earliest logged weight minus most recent, floored at 0 for weight gain.
function computeLbsLost() {
  if (!state.weights || state.weights.length === 0) return 0;
  const chronological = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const start = chronological[0].weight;
  const current = chronological[chronological.length - 1].weight;
  return Math.max(0, Math.round(kgToLbs(start - current)));
}

async function openMoreTab() {
  profileUsernameEl.textContent = state.user?.username || '—';

  moreProgressValueEl.textContent = `${computeLbsLost()} lbs`;
  const history = await loadHistory({ days: 60 });
  moreStreakValueEl.textContent = String(history ? computeLoggingStreak(history.days) : 0);
}

// Menu rows that map onto functionality already elsewhere in the app; every
// other row is a placeholder for a not-yet-built feature and just toasts.
const MORE_MENU_ACTIONS = {
  goals: () => openGoalsView(),
  'weight-measurements': () => openWeightMeasurementsModal(),
  nutrition: () => { switchTab('progress'); switchProgressSubtab('nutrients'); },
  'my-meals': () => { openLogOverlay(); switchLogSubtab('meals'); },
  steps: () => { switchTab('progress'); switchProgressSubtab('steps'); },
  sleep: () => { switchTab('progress'); switchProgressSubtab('sleep'); },
  'weekly-report': () => { switchTab('progress'); switchProgressSubtab('overview'); },
  settings: () => openSettingsView(),
  sync: async () => {
    await Promise.all([loadDay(), loadWeights(), loadProfile()]);
    showToast('Synced');
  }
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
