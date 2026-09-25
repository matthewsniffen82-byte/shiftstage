
    const userAgent = navigator.userAgent || "";
    if (/Android/i.test(userAgent)) {
      document.documentElement.classList.add("is-android", "android-rendering");
      document.body?.classList.add("is-android", "android-rendering");
    }
    if (/SamsungBrowser/i.test(userAgent)) {
      document.documentElement.classList.add("is-samsung-browser", "samsung-rendering");
      document.body?.classList.add("is-samsung-browser", "samsung-rendering");
    }
    window.__dancrApplyDeviceClasses?.();

    const STABLE_IMAGE_TIMEOUT_MS = 8000;
    const STABLE_IMAGE_MAX_RETRIES = 2;
    const stableImageRequests = new WeakMap();
    const stableImageVisibility = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            if (isIntersecting) watchStableImage(target);
          });
        }, { rootMargin: "300px" })
      : null;
    // Small lineup portraits need a head start before the next club card arrives.
    // Keep the shorter loading window for larger gallery photos and venue logos.
    const stableLineupVisibility = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            if (isIntersecting) watchStableImage(target);
          });
        }, { rootMargin: "1200px 0px" })
      : null;

    function stableImageRequest(image) {
      let state = stableImageRequests.get(image);
      if (!state) {
        state = { attempts: 0, timer: null };
        stableImageRequests.set(image, state);
      }
      return state;
    }

    function clearStableImageTimer(image) {
      const state = stableImageRequests.get(image);
      if (state?.timer !== null && state?.timer !== undefined) window.clearTimeout(state.timer);
      if (state) state.timer = null;
    }

    function stableImageRetryUrl(image, attempt) {
      const source = image.currentSrc || image.getAttribute("src");
      if (!source) return "";
      const url = new URL(source, window.location.href);
      // Retry the same approved, stored image without the resize service. Never
      // rewrite signed/private media URLs or guess a different storage object.
      if (url.protocol === "https:" && url.hostname.endsWith(".supabase.co")) {
        const resizePrefix = "/storage/v1/render/image/public/";
        if (url.pathname.startsWith(resizePrefix)) {
          url.pathname = url.pathname.replace(resizePrefix, "/storage/v1/object/public/");
          url.search = "";
        }
        if (url.pathname.startsWith("/storage/v1/object/public/")) {
          url.searchParams.set("image_retry", String(attempt));
        }
      }
      return url.href;
    }

    function retryStableImage(image) {
      const state = stableImageRequest(image);
      if (!image.isConnected || state.attempts >= STABLE_IMAGE_MAX_RETRIES) return false;
      let retryUrl;
      try { retryUrl = stableImageRetryUrl(image, state.attempts + 1); } catch { return false; }
      if (!retryUrl) return false;
      state.attempts += 1;
      image.dataset.imageState = "loading";
      image.removeAttribute("srcset");
      image.loading = "eager";
      image.fetchPriority = "auto";
      image.src = retryUrl;
      armStableImageTimeout(image);
      return true;
    }

    function settleStableImage(image, failed = false) {
      if (!(image instanceof HTMLImageElement) || !image.hasAttribute("data-image-state")) return;
      clearStableImageTimer(image);
      if (!failed && image.naturalWidth > 0) {
        image.dataset.imageState = "ready";
        stableImageVisibility?.unobserve(image);
        stableLineupVisibility?.unobserve(image);
        if (image.matches(".home-venue-discovery-logo, .venue-card-logo, .venue-detail-logo")) fitVenueLogoImage(image);
      } else if (!retryStableImage(image)) {
        image.dataset.imageState = "error";
        stableImageVisibility?.unobserve(image);
        stableLineupVisibility?.unobserve(image);
      }
    }

    function armStableImageTimeout(image) {
      clearStableImageTimer(image);
      const state = stableImageRequest(image);
      state.timer = window.setTimeout(() => {
        state.timer = null;
        if (!image.isConnected) return;
        settleStableImage(image, !image.complete || image.naturalWidth === 0);
      }, STABLE_IMAGE_TIMEOUT_MS);
    }

    function watchStableImage(image) {
      if (!image.isConnected || image.dataset.imageState !== "loading" || stableImageRequest(image).timer !== null) return;
      if (image.complete) settleStableImage(image);
      else {
        // Visible cards must not remain deferred by a mobile browser's lazy loader.
        image.loading = "eager";
        armStableImageTimeout(image);
      }
    }

    function settleCompletedStableImages(root = document) {
      const images = [...(root.querySelectorAll?.('img[data-image-state="loading"]') || [])];
      if (root instanceof HTMLImageElement && root.dataset.imageState === "loading") images.push(root);
      images.forEach((image) => {
        if (stableImageRequest(image).timer !== null) return;
        const visibility = image.matches(".venue-lineup-avatar-photo") ? stableLineupVisibility : stableImageVisibility;
        if (image.complete) settleStableImage(image);
        else if (image.loading !== "lazy" || !visibility) watchStableImage(image);
        else visibility.observe(image);
      });
    }

    document.addEventListener("load", (event) => settleStableImage(event.target), true);
    document.addEventListener("error", (event) => settleStableImage(event.target, true), true);
    // Rendered/cached images can complete before their DOM insertion. Reconcile
    // each inserted subtree instead of relying solely on a later load event.
    const stableImageInsertions = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => settleCompletedStableImages(node)));
    });
    stableImageInsertions.observe(document.body, { childList: true, subtree: true });
    settleCompletedStableImages();
    window.addEventListener("load", () => settleCompletedStableImages(), { once: true });

    const markets = {
      "Las Vegas": {
        stats: { dancers: 0, shifts: 0, venues: 0 },
        dancers: [],
        venues: []
      },
      Miami: {
        stats: { dancers: 0, shifts: 0, venues: 0 },
        dancers: [],
        venues: []
      },
      Atlanta: {
        stats: { dancers: 0, shifts: 0, venues: 0 },
        dancers: [],
        venues: []
      },
      "New York": {
        stats: { dancers: 0, shifts: 0, venues: 0 },
        dancers: [],
        venues: []
      }
    };

    const ALL_CITIES = "All cities";
    const allCitiesMarket = { stats: { dancers: 0, shifts: 0, venues: 0 }, dancers: [], venues: [] };
    let lastSpecificDiscoveryCity = "Las Vegas";
    try {
      const savedCity = window.sessionStorage.getItem("mydancrLastDiscoveryCity");
      if (savedCity && markets[savedCity]) lastSpecificDiscoveryCity = savedCity;
    } catch {}

    function discoveryMarket(city) {
      return city === ALL_CITIES ? allCitiesMarket : markets[city];
    }

    function profileDiscoveryCity(profile, city = selectedCity()) {
      return city === ALL_CITIES ? profile?.city || lastSpecificDiscoveryCity : city;
    }

    const citySelect = document.getElementById("citySelect");
    citySelect.value = lastSpecificDiscoveryCity;
    const cityPickerField = document.getElementById("cityPickerField");
    const citySelectLabel = document.getElementById("citySelectLabel");
    const citySelectButton = document.getElementById("citySelectButton");
    const citySelectButtonText = document.getElementById("citySelectButtonText");
    const citySelectPanel = document.getElementById("citySelectPanel");
    const citySelectOptions = document.getElementById("citySelectOptions");
    const distanceSelect = document.getElementById("distanceSelect");
    const distancePickerField = document.getElementById("distancePickerField");
    const distanceSelectLabel = document.getElementById("distanceSelectLabel");
    const distanceSelectButton = document.getElementById("distanceSelectButton");
    const distanceSelectButtonText = document.getElementById("distanceSelectButtonText");
    const distanceSelectDialog = document.getElementById("distanceSelectDialog");
    const distanceSelectOrigin = document.getElementById("distanceSelectOrigin");
    const distanceSelectForm = document.getElementById("distanceSelectForm");
    const distanceSelectClose = document.getElementById("distanceSelectClose");
    const venueSelect = document.getElementById("venueSelect");
    const venuePickerField = document.getElementById("venuePickerField");
    const venueSelectLabel = document.getElementById("venueSelectLabel");
    const venueSelectButton = document.getElementById("venueSelectButton");
    const venueSelectButtonText = document.getElementById("venueSelectButtonText");
    const venueSelectButtonLive = document.getElementById("venueSelectButtonLive");
    const venueSelectDialog = document.getElementById("venueSelectDialog");
    const venueSelectOptions = document.getElementById("venueSelectOptions");
    const venueSelectClose = document.getElementById("venueSelectClose");
    const venueSelectDone = document.getElementById("venueSelectDone");
    let pendingVenueSelection = "all";
    let venuePickerRestoreFocus = null;
    const homeFilterToggle = document.getElementById("homeFilterToggle");
    const homeAdvancedFilters = document.getElementById("homeAdvancedFilters");
    const homeFilterReset = document.getElementById("homeFilterReset");
    const results = document.getElementById("results");
    const discoveryTabs = document.getElementById("discoveryTabs");
    const discoveryTabsHomeParent = discoveryTabs?.parentNode || null;
    const discoveryTabsHomeNextSibling = discoveryTabs?.nextSibling || null;
    if (
      discoveryTabs &&
      window.innerWidth <= 720 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      window.requestAnimationFrame(() => {
        discoveryTabs.classList.add("is-introducing");
      });
      window.setTimeout(() => discoveryTabs.classList.remove("is-introducing"), 1100);
    }
    const tabTitle = document.getElementById("tabTitle");
    const tabCount = document.getElementById("tabCount");
    const toast = document.getElementById("toast");
    const profileBackdrop = document.getElementById("profileBackdrop");
    const profileModal = document.getElementById("profileModal");
    const modalImage = document.getElementById("modalImage");
    const modalProfileAvatar = document.getElementById("modalProfileAvatar");
    const modalProfileAvatarBorder = document.getElementById("modalProfileAvatarBorder");
    const modalProfileMetrics = document.getElementById("modalProfileMetrics");
    const profilePhotoViewer = document.getElementById("profilePhotoViewer");
    const profilePhotoViewerImage = document.getElementById("profilePhotoViewerImage");
    const profilePhotoViewerLike = document.getElementById("profilePhotoViewerLike");
    const profilePhotoViewerShare = document.getElementById("profilePhotoViewerShare");
    const profilePhotoViewerReport = document.getElementById("profilePhotoViewerReport");
    const profilePhotoViewerPrevious = document.getElementById("profilePhotoViewerPrevious");
    const profilePhotoViewerNext = document.getElementById("profilePhotoViewerNext");
    const profilePhotoViewerStatus = document.getElementById("profilePhotoViewerStatus");
    if (profilePhotoViewer) document.body.appendChild(profilePhotoViewer);
    let profilePhotoViewerReturnTarget = null;
    let profilePhotoViewerScrollFrame = 0;
    const modalName = document.getElementById("modalName");
    const modalStatus = document.getElementById("modalStatus");
    const modalCity = document.getElementById("modalCity");
    const modalRank = document.getElementById("modalRank");
    const modalGallery = document.getElementById("modalGallery");
    const modalMediaSocials = document.getElementById("modalMediaSocials");
    const modalMediaPhotoTab = document.getElementById("modalMediaPhotoTab");
    const modalMediaTvTab = document.getElementById("modalMediaTvTab");
    const modalMediaPhotoCount = document.getElementById("modalMediaPhotoCount");
    const modalMediaTvCount = document.getElementById("modalMediaTvCount");
    const modalMediaEmpty = document.getElementById("modalMediaEmpty");
    const modalMediaPosition = document.getElementById("modalMediaPosition");
    const modalMediaPrevious = document.getElementById("modalMediaPrevious");
    const modalMediaNext = document.getElementById("modalMediaNext");
    const modalMediaExpand = document.getElementById("modalMediaExpand");
    const modalVideoControls = document.getElementById("modalVideoControls");
    const modalVideoPlayback = document.getElementById("modalVideoPlayback");
    const modalVideoPlaybackFeedback = document.getElementById("modalVideoPlaybackFeedback");
    const modalVideoSound = document.getElementById("modalVideoSound");
    const modalVideoProgress = document.getElementById("modalVideoProgress");
    const modalVideoTime = document.getElementById("modalVideoTime");
    let modalVideoControlsHideTimer = 0;
    let modalVideoPlaybackFeedbackTimer = 0;
    let modalProfileVideoMuted = true;
    const modalBody = document.getElementById("modalBody");
    const viewAllBtn = document.getElementById("viewAllBtn");
    const cityCoordinates = {
      "Las Vegas": { latitude: 36.1699, longitude: -115.1398 },
      Miami: { latitude: 25.7617, longitude: -80.1918 },
      Atlanta: { latitude: 33.749, longitude: -84.388 },
      "New York": { latitude: 40.7128, longitude: -74.006 }
    };
    const MAX_LOCATION_MARKET_DISTANCE_MILES = 50;
    let userLocation = null;
    let userLocationOutsideMarkets = false;
    const authPage = document.getElementById("authPage");
    const passwordRecoveryCard = document.getElementById("passwordRecoveryCard");
    const passwordRecoveryForm = document.getElementById("passwordRecoveryForm");
    const passwordRecoveryClose = document.getElementById("passwordRecoveryClose");
    const passwordRecoveryBack = document.getElementById("passwordRecoveryBack");
    const passwordRecoveryStatus = document.getElementById("passwordRecoveryStatus");
    const loginRecoveryCard = document.getElementById("loginRecoveryCard");
    const loginRecoveryForm = document.getElementById("loginRecoveryForm");
    const loginRecoveryClose = document.getElementById("loginRecoveryClose");
    const loginRecoveryBack = document.getElementById("loginRecoveryBack");
    const loginRecoveryStatus = document.getElementById("loginRecoveryStatus");
    [passwordRecoveryCard, loginRecoveryCard].forEach((popover) => {
      if (popover && popover.parentElement !== document.body) document.body.appendChild(popover);
    });
    const dancerSignupPage = document.getElementById("dancerSignupPage");
    const stripeCheckoutPage = document.getElementById("stripeCheckoutPage");
    const dancerDashboard = document.getElementById("dancerDashboard");
    const customerDashboard = document.getElementById("customerDashboard");
    const venueDashboard = document.getElementById("venueDashboard");
    const adminDashboard = document.getElementById("adminDashboard");
    const adminPreviewPopover = document.getElementById("adminPreviewPopover");
    const adminPreviewTitle = document.getElementById("adminPreviewTitle");
    const adminPreviewBody = document.getElementById("adminPreviewBody");
    const adminPreviewClose = document.getElementById("adminPreviewClose");
    const publicContactPopover = document.getElementById("publicContactPopover");
    const publicContactClose = document.getElementById("publicContactClose");
    const publicContactForm = document.getElementById("publicContactForm");
    const publicContactStatus = document.getElementById("publicContactStatus");
    const accountRequiredPopover = document.getElementById("accountRequiredPopover");
    const accountRequiredClose = document.getElementById("accountRequiredClose");
    const accountRequiredMessage = document.getElementById("accountRequiredMessage");
    const accountRequiredCreateLink = document.getElementById("accountRequiredCreateLink");
    const accountRequiredSignInLink = document.getElementById("accountRequiredSignInLink");
    const contentReportPopover = document.getElementById("contentReportPopover");
    const contentReportClose = document.getElementById("contentReportClose");
    const contentReportCancel = document.getElementById("contentReportCancel");
    const contentReportForm = document.getElementById("contentReportForm");
    const contentReportQuickOptions = document.getElementById("contentReportQuickOptions");
    const contentReportTitle = document.getElementById("contentReportTitle");
    const contentReportMessage = document.getElementById("contentReportMessage");
    const contentReportReason = document.getElementById("contentReportReason");
    const contentReportDetails = document.getElementById("contentReportDetails");
    const contentReportStatus = document.getElementById("contentReportStatus");
    const contentReportSubmit = document.getElementById("contentReportSubmit");
    const reportedContentTargets = new Set();
    let activeContentReport = null;
    const dashboardBtn = document.getElementById("dashboardBtn");
    const accountBtn = document.getElementById("accountBtn");
    const guestMenuBtn = document.getElementById("guestMenuBtn");
    const accountTooltip = document.getElementById("accountTooltip");
    const logoutBtn = document.getElementById("logoutBtn");
    const sessionMenuEnd = document.getElementById("sessionMenuEnd");
    const adminBtn = document.getElementById("adminBtn");
    const contactAdminBtn = document.getElementById("contactAdminBtn");
    const moreMenuPanel = document.getElementById("moreMenuPanel");
    const customerQuickActions = document.getElementById("customerQuickActions");
    const customerNotificationQuickBtn = document.getElementById("customerNotificationQuickBtn");
    const dancerProfileShareQuickBtn = document.getElementById("dancerProfileShareQuickBtn");
    const customerDealQuickBtn = document.getElementById("customerDealQuickBtn");
    const customerNotificationQuickCount = document.getElementById("customerNotificationQuickCount");
    const customerDealQuickCount = document.getElementById("customerDealQuickCount");
    const customerDealQuickCta = document.getElementById("customerDealQuickCta");
    const customerNotificationsQuickPanel = document.getElementById("customerNotificationsQuickPanel");
    const customerDealsQuickPanel = document.getElementById("customerDealsQuickPanel");
    const customerNotificationsQuickList = document.getElementById("customerNotificationsQuickList");
    const customerDealsQuickList = document.getElementById("customerDealsQuickList");
    const brandHome = document.getElementById("brandHome");
    const dashTonightList = document.getElementById("dashTonightList");
    const dashFollowedList = document.getElementById("dashFollowedList");
    const dashVenueList = document.getElementById("dashVenueList");
    const dashSavedDealsList = document.getElementById("dashSavedDealsList");
    const dashTonightViewAll = document.getElementById("dashTonightViewAll");
    const dashFollowedViewAll = document.getElementById("dashFollowedViewAll");
    const dashVenueViewAll = document.getElementById("dashVenueViewAll");
    const notificationSettings = document.getElementById("notificationSettings");
    const customerNotificationList = document.getElementById("customerNotificationList");
    const dancerNotificationList = document.getElementById("dancerNotificationList");
    const customerBrowseTonight = document.getElementById("customerBrowseTonight");
    const customerBrowseDancers = document.getElementById("customerBrowseDancers");
    const homeFeedReturnHomeBtn = document.getElementById("homeFeedReturnHomeBtn");
    let activeTab = "dancers";
    let dancerDirectoryFilter = "now";
    let homeTvLaunchRequest = 0;
    let homeTvLaunchScope = "";
    let homeTvFeedRequest = 0;
    let homeTvFeedAbort = null;
    let homeTvFeedCity = "";
    let homeTvFeedVenueId = "";
    let homeTvFeedSelectedVideoId = "";
    let homeTvFeedStatus = "idle";
    let homeTvFeedVideos = [];
    let homeTvFeedNextCursor = null;
    let homeTvFeedPageAbort = null;
    let homeTvFeedPageError = false;
    let homeTvFeedLoopStarted = false;
    const homeTvLandingPreload = createHomeTvLandingPreloader();
    window.addEventListener("load", () => homeTvLandingPreload.schedule(), { once: true });
    const homeTvLandingConnection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    homeTvLandingConnection?.addEventListener?.("change", () => {
      if (!canWarmAdjacentVideo()) homeTvLandingPreload.clear();
    });
    let homeTvFeedObserver = null;
    let homeTvFeedActiveVideoId = "";
    let homeTvFeedMuted = true;
    let homeTvFeedLandingPending = false;
    let homeTvFeedWasFullscreen = false;
    let homeTvFeedFullscreenReturnScrollY = 0;
    const homeTvFeedSnapMedia = window.matchMedia("(max-width: 720px)");
    let homeTvPageScrollRail = null;
    let homeTvPageScrollThumb = null;
    let homeTvPageScrollFrame = 0;
    let homeTvPageScrollIdleTimer = 0;
    let homeTvPageScrollResizeObserver = null;
    const homeTvFeedImpressions = new Set();
    const homeTvFeedEngagedViews = new Set();
    const homeTvFeedCompletedViews = new Set();
    const publicMediaLikeStates = new Map();
    const publicMediaLikeLoads = new Map();
    const homeTvFeedEngagedTimers = new Map();
    let homeDiscoveryFeedOpen = false;
    let homeDiscoveryFeedObserver = null;
    let homeDiscoveryFeedQrPromptTimer = 0;
    let homeDiscoveryFeedQrPromptKey = "";
    let homeDiscoveryFeedRenderKey = "";
    let homeDancerGridRenderKey = "";
    const homeDiscoveryFeedPositions = new Map();
    const homeDiscoveryFeedQrPromptsShown = new Set();
    const HOME_DISCOVERY_QR_PROMPT_DELAY_MS = 3000;
    const HOME_DISCOVERY_REFRESH_MS = 30000;
    const PROFILE_NAVIGATION_PREFETCH_TTL_MS = 20 * 1000;
    const PROFILE_NAVIGATION_PREFETCH_LIMIT = 4;
    const profileNavigationPrefetchCache = new Map();
    const PUBLIC_DISCOVERY_REFRESH_KEY = "mydancrPublicDiscoveryRefreshV1";
    let savedScrollY = 0;
    let tonightExpanded = false;
    let dancersExpanded = false;
    let selectedVenueName = null;
    let venueProfileSavedScrollY = 0;
    let venueProfileReturnContext = null;
    let clubDealOverlayReturnContext = null;
    let isCustomerLoggedIn = false;
    let isDancerLoggedIn = false;
    let isVenueLoggedIn = false;
    let authMode = "login";
    let authEntryMode = "signin";
    let authRoleHint = "customer";
    let venueAuthMode = "signup";
    const confirmationResendTimers = new Map();
    let verifiedVenueSignupCode = "";
    let verifiedVenueSignupPreview = null;
    let pendingVenueAuthReturnTo = "";
    let pendingAccountAuthReturnTo = "";
    let pendingVenueAgentReferralCode = "";
    let adminAuthMode = "login";
    let adminApprovedDancerSearch = "";
    let adminDisapprovedDancerSearch = "";
    const ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY = "dancrAdminClosedApprovalCardsV1";
    const adminClosedDancerApprovalCards = loadClosedAdminApprovalCards();
    let authSession = loadAuthSession();
    let visibleAuthAccountIdentity = browserAccountIdentity(authSession);
    let dancerSignupStarted = false;
    let dancerSignupCities = [];
    let dancerSignupCitiesState = "idle";
    let dancerSignupCitiesRequest = null;
    const cityDiscoveryStatsByName = new Map();
    let pendingDancerSignupCity = "";
    let stripeConfirmed = false;
    let activeDashboardType = "customer";
    let activeVenueName = "Moonline Social";
    let liveVenueDashboard = null;
    let liveDancerVenueVerification = null;
    let dancerVenueVerificationRequest = null;
    let dancerVenueApprovalPollTimer = 0;
    let activeDancerVenueVerification = null;
    let activeVenueDancerVerification = null;
    let dancerVenueVerificationRenewTimer = 0;
    let dancerVenueVerificationApprovalPoll = 0;
    const PENDING_VENUE_DANCER_VERIFICATION_KEY = "dancrPendingVenueDancerVerificationV1";
    let activeSetupStep = "profile";
    let setupChecklistExpanded = false;
    let dancerSetupRefreshPending = false;
    let profileModalReturnTarget = "";
    let profileModalReturnContext = null;
    let lastPostedShift = null;
    const localPostedShiftStore = new Map();
    let localPostedShiftList = [];
    const dancerSetup = {
      profile: false,
      photos: false,
      review: false,
      approval: false,
      shift: false
    };
    let profileSubmitNotice = "";
    let profileSubmitNoticeTone = "";
    let freshDancerVerificationLockedToProfile = false;
    const accountControlState = {
      customer: {
        disabled: false,
        deleted: false
      },
      dancer: {
        disabled: false,
        deleted: false
      }
    };
    const accountControlCopy = {
      customer: {
        active: "Your private follows, club alerts, and going signals stay active.",
        disabled: "Your guest account is paused. Alerts are off, but follows and notification settings are saved.",
        deleted: "This guest account was permanently deleted."
      },
      dancer: {
        active: "Your public profile, schedule posting, analytics, and follower alerts stay active.",
        disabled: "Your dancer account is temporarily disabled. Your public profile is hidden and shift posting is paused, but setup is saved.",
        deleted: "This dancer account was deleted. You can sign up again with the same email to start a new dancer account."
      }
    };
    const dancerSignupSocials = {
      instagram: "",
      tiktok: "",
      snapchat: "",
      onlyfans: "",
      x: ""
    };
    let dashboardTonightExpanded = false;
    let dashboardFollowedExpanded = false;
    let dashboardVenuesExpanded = false;
    let savedDealPassesStorageKey = savedDealsStorageKey();
    let savedDealPasses = loadSavedDealPasses();
    let activeProfileClubDealPassCache = null;
    const goingTonightByProfile = {};
    const goingTonightSavedByProfile = {};
    const trendEventStoreKey = "dancrTrendEventsV1";
    const trendEventStore = loadTrendEventStore();
    const liveMarketState = {};
    const liveMarketRefreshes = new Set();
    const liveMarketPendingRefreshes = new Set();
    let liveDancerAnalytics = null;
    let liveDancerDeals = null;
    let liveDancerWeeklyReport = null;
    let liveDancerBilling = null;
    let liveDancerRankingEvents = [];
    let liveDancerReviews = [];
    let liveAdminSubscriptions = [];
    let liveAdminReports = [];
    let liveAdminMonitoring = null;
    let liveAdminOperations = null;
    let liveAdminImageModeration = [];
    let liveCustomerProfile = null;
    let liveNotifications = [];
    let liveNotificationsState = authSession?.accessToken ? "loading" : "idle";
    let liveNotificationsRequestVersion = 0;
    let liveNotificationClearPending = null;
    let liveSupportThreads = [];
    let liveSupportThreadsState = authSession?.accessToken ? "loading" : "idle";
    let liveAdminSupportThreads = [];
    let liveAdminSupportThreadsState = authSession?.accessToken ? "loading" : "idle";
    let liveCustomerDashboardState = authSession?.accessToken && authSession?.account?.role === "customer" ? "loading" : "idle";
    let savedAdminContentReviews = [];
    let savedAdminContentReviewAccount = "";
    let editingShiftId = null;
    let pendingApprovedPhotoTarget = "gallery";
    let pendingAvatarObjectUrl = "";
    let pendingAvatarSetupStep = "";
    let activeApprovedVisualPhotoTarget = "";
    let pendingApprovedPhotoAutoSubmit = false;
    let approvedPhotoEditMode = false;
    let approvedSocialEditMode = false;
    let approvedProfileSaveConfirmed = false;
    let activeApprovedToolDropdown = "";
    let approvedProfileVideoWorkspace = null;
    let approvedProfileVideoLoading = false;
    let approvedProfileVideoSubmitting = false;
    let approvedProfileVideoRemovingId = "";
    let approvedProfileVideoStatus = "";
    let approvedProfileVideoStatusTone = "";
    let pendingSetupPhotoFiles = [];
    let pendingSetupPhotoPreviewUrls = [];
    let pendingApprovedProfileVideoFile = null;
    let pendingApprovedProfileVideoPreviewUrl = "";
    let pendingApprovedProfileVideoConsent = false;
    let pendingApprovedProfileVideoRights = false;
    let shiftCheckInMessage = "";
    let shiftCheckInTone = "";
    let shiftCheckInCode = "";
    let shiftLocationRefreshTimer = 0;
    let shiftLocationRefreshShiftId = "";
    const SHIFT_LOCATION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
    const MAX_DANCER_PROFILE_PHOTOS = 50;
    const MAX_DANCER_PROFILE_VIDEOS = 50;
    const PROFILE_MEDIA_PAGE_SIZE = 12;
    const PROFILE_MEDIA_BATCH_SCROLL_STEP = 96;
    let profileMediaObserver = null;
    let profileMediaObserverScrollFrame = 0;
    let profileMediaLastAppendScrollTop = 0;
    console.log("PHOTO_NUMBERING_FIX_VERSION", "2026-07-13-v1");

    const stateByCity = {
      "Las Vegas": "NV",
      Miami: "FL",
      Atlanta: "GA",
      "New York": "NY"
    };

    const timeZoneByCity = {
      "Las Vegas": "America/Los_Angeles",
      Miami: "America/New_York",
      Atlanta: "America/New_York",
      "New York": "America/New_York"
    };

    const followedByCity = {
      "Las Vegas": [],
      Miami: [],
      Atlanta: [],
      "New York": []
    };
    const favoritedByCity = {};
    const followedDancerIds = new Set();
    const notifiedByCity = Object.fromEntries(
      Object.entries(followedByCity).map(([city, names]) => [city, [...names]])
    );
    const followedVenuesByCity = Object.fromEntries(
      Object.keys(markets).map((city) => [city, []])
    );
    let customerSavedStateVersion = 0;

    function clearCustomerSavedCollections() {
      followedDancerIds.clear();
      Object.keys(markets).forEach((city) => {
        followedByCity[city] = [];
        favoritedByCity[city] = [];
        notifiedByCity[city] = [];
        followedVenuesByCity[city] = [];
      });
      Object.keys(goingTonightSavedByProfile).forEach((profileName) => {
        delete goingTonightSavedByProfile[profileName];
      });
    }

    function clearLiveProfileActionCollections() {
      followedDancerIds.clear();
      Object.keys(markets).forEach((city) => {
        followedByCity[city] = [];
        notifiedByCity[city] = [];
      });
      Object.keys(goingTonightSavedByProfile).forEach((profileName) => {
        delete goingTonightSavedByProfile[profileName];
      });
    }

    function prepareRealCustomerDashboardState() {
      if (!isCustomerSession()) return;
      customerSavedStateVersion += 1;
      clearCustomerSavedCollections();
    }

    const adminUsers = [];

    Object.values(markets).forEach((market) => {
      market.dancers.forEach((profile, index) => {
        profile.photoStatus ??= profile.status === "Verified" ? "Approved" : "Pending";
        profile.featured ??= index === 0 && profile.status === "Verified";
        profile.hidden ??= false;
        profile.contentFlagged ??= profile.status === "Pending" && index % 2 === 1;
        if (profile.status === "Verified") {
          const handle = slugify(profile.name).replaceAll("-", "");
          profile.socials ??= {
            instagram: `https://instagram.com/${handle}`,
            tiktok: `https://tiktok.com/@${handle}`,
            snapchat: `https://snapchat.com/add/${handle}`,
            onlyfans: `https://onlyfans.com/${handle}`,
            x: `https://x.com/${handle}`
          };
        } else {
          profile.socials ??= {};
        }
      });
      market.venues.forEach((venue, index) => {
        venue.featured ??= index === 0;
        venue.hidden ??= false;
      });
    });

    function dancerProfileIsHidden(profile) {
      return Boolean(profile?.hidden || profile?.isPublic === false || profile?.is_public === false);
    }

    function setDancerProfilePublic(profile, isPublic = true) {
      if (!profile) return;
      profile.hidden = !isPublic;
      profile.isPublic = isPublic;
      profile.is_public = isPublic;
    }

    function isApprovedPublicProfile(profile) {
      const normalizedStatus = String(profile?.status || "").trim().toLowerCase();
      return Boolean(
        profile &&
        (normalizedStatus === "verified" || normalizedStatus === "approved") &&
        !dancerProfileIsHidden(profile)
      );
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add("show");
      window.clearTimeout(showToast.timer);
      showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1900);
    }

    function showCardQrNotice(trigger, label, message) {
      const card = trigger?.closest(".home-dancer-grid-card, .home-venue-discovery-slide, .home-tv-feed-slide");
      if (!card) {
        showToast(message || label || "No Club Deal is available right now.");
        return;
      }

      window.clearTimeout(showCardQrNotice.timer);
      window.clearTimeout(showCardQrNotice.removeTimer);
      document.querySelectorAll(".home-card-qr-notice").forEach((notice) => notice.remove());
      document.querySelectorAll('[data-card-action-slot="qr"][aria-expanded="true"]').forEach((button) => {
        button.setAttribute("aria-expanded", "false");
      });

      const notice = document.createElement("div");
      const heading = document.createElement("strong");
      const detail = document.createElement("span");
      const cardRect = card.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const triggerCenter = triggerRect.top - cardRect.top + (triggerRect.height / 2);
      const noticeCenter = Math.min(
        Math.max(70, triggerCenter),
        Math.max(70, cardRect.height - 70)
      );
      notice.className = "home-card-qr-notice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      heading.textContent = label || "Club Deal tap";
      detail.textContent = message || "No Club Deal is available right now.";
      notice.append(heading, detail);
      notice.style.setProperty(
        "--home-card-qr-notice-top",
        `${Math.round(noticeCenter)}px`
      );
      notice.style.setProperty(
        "--home-card-qr-notice-right",
        `${Math.max(68, Math.round(cardRect.right - triggerRect.left + 8))}px`
      );
      card.append(notice);
      trigger.setAttribute("aria-expanded", "true");
      window.requestAnimationFrame(() => notice.classList.add("is-visible"));

      showCardQrNotice.timer = window.setTimeout(() => {
        notice.classList.remove("is-visible");
        trigger.setAttribute("aria-expanded", "false");
        showCardQrNotice.removeTimer = window.setTimeout(() => notice.remove(), 180);
      }, 4200);
    }

    function adminPreviewIsImage(url) {
      return /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(String(url || ""));
    }

    function openAdminPreview({ kind = "file", title = "Preview", url = "" } = {}) {
      if (!adminPreviewPopover || !adminPreviewBody || !adminPreviewTitle) return;
      if (!url || url === "#") {
        showToast("No preview available");
        return;
      }
      const previewUrl = safeExternalHref(url);
      if (!previewUrl) {
        showToast("No preview available");
        return;
      }
      const safeUrl = displayText(previewUrl);
      const safeTitle = displayText(title || "Preview");
      adminPreviewTitle.textContent = title || "Preview";
      if (kind === "image" || adminPreviewIsImage(url)) {
        adminPreviewBody.innerHTML = `<img src="${safeUrl}" alt="${safeTitle}">`;
      } else if (kind === "link") {
        adminPreviewBody.innerHTML = `
          <div class="admin-preview-link">
            <strong>Submitted link</strong>
            <p>${safeUrl}</p>
            <a href="${safeUrl}" target="_blank" rel="noreferrer">Open link</a>
          </div>
        `;
      } else {
        adminPreviewBody.innerHTML = `
          <iframe src="${safeUrl}" title="${safeTitle}"></iframe>
          <div class="admin-preview-link">
            <p>${safeUrl}</p>
            <a href="${safeUrl}" target="_blank" rel="noreferrer">Open file</a>
          </div>
        `;
      }
      adminPreviewPopover.hidden = false;
    }

    function closeAdminPreview() {
      if (!adminPreviewPopover || !adminPreviewBody) return;
      adminPreviewPopover.hidden = true;
      adminPreviewBody.innerHTML = "";
    }

    function openPublicContactForm() {
      if (!publicContactPopover) return;
      if (publicContactStatus) {
        publicContactStatus.textContent = "";
        delete publicContactStatus.dataset.state;
      }
      publicContactPopover.hidden = false;
      publicContactPopover.showModal();
      document.body.classList.add("public-contact-open");
      syncPublicContactViewport();
      publicContactForm?.querySelector(".public-contact-fields")?.scrollTo({ top: 0 });
      publicContactClose?.focus({ preventScroll: true });
    }

    function syncPublicContactViewport() {
      if (!publicContactPopover?.open) return;
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      publicContactPopover.style.setProperty("--contact-viewport-height", `${height}px`);
      publicContactPopover.style.setProperty("--contact-viewport-top", `${viewport?.offsetTop || 0}px`);
      publicContactPopover.classList.toggle("is-compact", height < 500);
      const focusedField = document.activeElement;
      if (publicContactForm?.contains(focusedField) && focusedField.matches("input, textarea")) {
        requestAnimationFrame(() => {
          if (publicContactPopover.open && document.activeElement === focusedField) {
            focusedField.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        });
      }
    }

    function closePublicContactForm() {
      if (!publicContactPopover) return;
      publicContactPopover.close();
      publicContactPopover.hidden = true;
      document.body.classList.remove("public-contact-open");
      const returnTarget = guestMenuBtn && !guestMenuBtn.hidden ? guestMenuBtn : accountBtn;
      returnTarget?.focus({ preventScroll: true });
    }

    let accountRequiredReturnTarget = null;

    function profileActionAccountMessage(actionButton) {
      const actionId = actionButton?.id || "";
      if (actionButton?.dataset?.accountAction === "venue-follow") {
        return "Create a free account to save clubs, follow favorites, and get updates.";
      }
      const action = actionButton?.dataset?.feedAction || actionId;
      if (action === "notify" || action === "notifyBtn") {
        return "Create a free account to follow dancers and get updates.";
      }
      return "Create a free account to follow dancers, save profiles, and get updates.";
    }

    function openAccountRequiredPrompt(actionButton) {
      if (!accountRequiredPopover) return;
      accountRequiredReturnTarget = actionButton || null;
      if (accountRequiredMessage) {
        accountRequiredMessage.textContent = profileActionAccountMessage(actionButton);
      }
      accountRequiredPopover.hidden = false;
      syncOverlayScrollLock();
      setTimeout(() => accountRequiredClose?.focus({ preventScroll: true }), 40);
    }

    function closeAccountRequiredPrompt({ restoreFocus = true } = {}) {
      if (!accountRequiredPopover) return;
      accountRequiredPopover.hidden = true;
      syncOverlayScrollLock();
      const returnTarget = accountRequiredReturnTarget;
      accountRequiredReturnTarget = null;
      if (restoreFocus && returnTarget?.isConnected) {
        setTimeout(() => returnTarget.focus({ preventScroll: true }), 40);
      }
    }

    function requireCustomerAccountForProfileAction(actionButton) {
      synchronizeAuthSession();
      if (authSession?.accessToken && isCustomerSession()) return true;
      openAccountRequiredPrompt(actionButton);
      return false;
    }

    function contentReportKey(targetType, targetId) {
      return `${String(targetType || "").trim()}:${String(targetId || "").trim()}`;
    }

    function isReportableContentId(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
    }

    function prepareContentReportButton(button, targetType, targetId, label = "Report content") {
      if (!button) return;
      const normalizedType = String(targetType || "").trim();
      const normalizedId = String(targetId || "").trim();
      const reported = reportedContentTargets.has(contentReportKey(normalizedType, normalizedId));
      button.dataset.reportTargetType = normalizedType;
      button.dataset.reportTargetId = normalizedId;
      button.disabled = !normalizedType || !isReportableContentId(normalizedId) || reported;
      button.setAttribute("aria-label", reported ? "Content reported" : label);
      if (button.id === "reportBtn") {
        button.removeAttribute("aria-pressed");
        button.classList.toggle("is-reported", reported);
        const buttonLabel = button.querySelector("span");
        if (buttonLabel) buttonLabel.textContent = reported ? "Reported" : "Report profile";
      } else {
        button.setAttribute("aria-pressed", String(reported));
      }
    }

    function openContentReportDialog({ button, status, targetType, targetId, targetLabel, title, quickReasons = false }) {
      if (!contentReportPopover || !targetType || !targetId) {
        if (status) status.textContent = "This content cannot be reported right now.";
        else showToast("This content cannot be reported right now");
        return;
      }
      const reportKey = contentReportKey(targetType, targetId);
      if (reportedContentTargets.has(reportKey)) {
        if (status) status.textContent = "You already reported this content.";
        else showToast("You already reported this content");
        return;
      }
      activeContentReport = {
        button: button || null,
        status: status || null,
        targetType: String(targetType),
        targetId: String(targetId),
        targetLabel: String(targetLabel || "Reported content"),
        reportKey,
        quickReasons: Boolean(quickReasons)
      };
      contentReportTitle.textContent = String(title || "Report content");
      contentReportPopover.classList.toggle("is-quick-reason", Boolean(quickReasons));
      contentReportQuickOptions.hidden = !quickReasons;
      contentReportMessage.hidden = Boolean(quickReasons);
      contentReportReason.value = "";
      contentReportDetails.value = "";
      contentReportStatus.textContent = "";
      contentReportSubmit.disabled = false;
      contentReportSubmit.textContent = "Submit report";
      contentReportQuickOptions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      const fullscreenHost = document.fullscreenElement || document.webkitFullscreenElement;
      (fullscreenHost || document.body).appendChild(contentReportPopover);
      contentReportPopover.hidden = false;
      syncOverlayScrollLock();
      setTimeout(() => {
        const focusTarget = quickReasons
          ? contentReportQuickOptions?.querySelector("button")
          : contentReportReason;
        focusTarget?.focus({ preventScroll: true });
      }, 40);
    }

    function closeContentReportDialog({ restoreFocus = true } = {}) {
      if (!contentReportPopover) return;
      const returnTarget = activeContentReport?.button || null;
      contentReportPopover.hidden = true;
      activeContentReport = null;
      contentReportStatus.textContent = "";
      document.body.appendChild(contentReportPopover);
      syncOverlayScrollLock();
      if (restoreFocus && returnTarget?.isConnected) {
        setTimeout(() => returnTarget.focus({ preventScroll: true }), 40);
      }
    }

    async function submitContentReportDialog(event) {
      event.preventDefault();
      const report = activeContentReport;
      if (!report) return;
      const reason = String(contentReportReason.value || "").trim();
      if (!reason) {
        contentReportStatus.textContent = "Choose a reason before submitting.";
        contentReportReason.focus();
        return;
      }
      contentReportSubmit.disabled = true;
      contentReportSubmit.textContent = "Submitting…";
      if (report.quickReasons) {
        contentReportQuickOptions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      }
      contentReportStatus.textContent = "";
      try {
        const data = await postOptionalAuthJson("/api/reports", {
          targetType: report.targetType,
          targetId: report.targetId,
          targetLabel: report.targetLabel,
          reason,
          details: String(contentReportDetails.value || "").trim()
        });
        if (!data?.report) throw new Error("The report could not be confirmed.");
        reportedContentTargets.add(report.reportKey);
        prepareContentReportButton(
          report.button,
          report.targetType,
          report.targetId,
          report.button?.dataset.reportDefaultLabel || "Report content"
        );
        if (report.status) report.status.textContent = "Report submitted for review.";
        if (report.targetType === "dancer_profile") {
          recordLiveEvent("profile_action", { dancerName: report.targetLabel, source: "report_submitted" });
        }
        if (report.targetType === "tv_video") {
          void trackHomeTvFeedEvent(report.targetId, "report");
        }
        showToast("Report submitted for review");
        closeContentReportDialog({ restoreFocus: false });
      } catch (error) {
        contentReportStatus.textContent = error.message || "Could not submit report.";
        contentReportSubmit.disabled = false;
        contentReportSubmit.textContent = "Submit report";
        contentReportQuickOptions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
    }

    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js?v=safe-public-cache-v2", { updateViaCache: "none" })
          .catch(() => {});
      });
    }

    function dancrLiveSessionId() {
      const key = "dancr_live_session_id";
      let id = localStorage.getItem(key);
      if (!id) {
        id = `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(key, id);
      }
      return id;
    }
