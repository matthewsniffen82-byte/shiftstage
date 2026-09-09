export const androidDeviceClassScript = `
(() => {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.userAgentData && navigator.userAgentData.platform
    ? navigator.userAgentData.platform
    : "";
  const isAndroid = /Android/i.test(userAgent)
    || /Linux.*Mobile/i.test(userAgent)
    || /Android/i.test(platform);
  const isSamsungBrowser = /SamsungBrowser/i.test(userAgent);

  if (!isAndroid && !isSamsungBrowser) return;

  const applyDeviceClasses = (element) => {
    if (!element) return;
    if (isAndroid) element.classList.add("is-android", "android-rendering");
    if (isSamsungBrowser) element.classList.add("is-samsung-browser", "samsung-rendering");
  };

  applyDeviceClasses(document.documentElement);
  applyDeviceClasses(document.body);
})();
`;
