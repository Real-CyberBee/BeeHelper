// 窄屏默认收起目录，让读者先看到正文；仍可通过原生 details 手动展开。
const navigation = document.querySelector(".docs-sidebar details");
const narrow = matchMedia("(max-width: 760px)");
const syncNavigation = () => { if (navigation) navigation.open = !narrow.matches; };
syncNavigation();
narrow.addEventListener("change", syncNavigation);
