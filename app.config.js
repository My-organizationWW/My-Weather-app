const pkg = require('./package.json');

// Android requires a strictly increasing integer versionCode, otherwise a
// patch APK cannot be installed over the previous release. Derive it from the
// semantic version: 1.0.23 -> 1002300, 1.0.23.1 -> 1002301.
const [major = 0, minor = 0, patch = 0, micro = 0] = pkg.version
  .split('.')
  .map((part) => parseInt(part, 10) || 0);
const versionCode = major * 1000000 + minor * 10000 + patch * 100 + micro;

export default {
  expo: {
    name: "Моя погода",
    slug: "my-app-final",
    version: pkg.version,
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    splash: {
      image: "./assets/splash.png",
      resizeMode: "cover",
      backgroundColor: "#ffffff"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.bladvin.myappfinal"
    },
    android: {
      package: "com.bladvin.myappfinal",
      versionCode,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      colors: {
        primary: "#023c69",
        primaryDark: "#ffffff",
        background: "#ffffff"
      },
      permissions: [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_EXTERNAL_STORAGE"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      "expo-localization",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "Allow $(PRODUCT_NAME) to use your location."
        }
      ],
      "expo-font",
      "expo-status-bar",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          imageWidth: 400,
          resizeMode: "cover",
          backgroundColor: "#ffffff"
        }
      ],
      [
        "./plugins/localized-app-name",
        {
          englishName: "My Weather"
        }
      ],
      "./plugins/abi-splits",
      "./plugins/android-window-background"
    ],
    extra: {
      eas: {
        projectId: "2b5d5c39-a1c2-4959-ad98-da372592df88"
      }
    }
  }
};
