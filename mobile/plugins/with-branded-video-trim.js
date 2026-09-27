const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// The upstream editor exposes its trim colour but hardcodes its save/progress
// colours. Keep this small, idempotent native patch reproducible in every APK.
function patchVideoTrim(projectRoot) {
  const root = path.dirname(require.resolve("react-native-video-trim/package.json", { paths: [projectRoot] }));
  const widget = path.join(root, "android/src/main/java/com/videotrim/widgets/VideoTrimmerView.kt");
  const modulePath = path.join(root, "android/src/main/java/com/videotrim/BaseVideoTrimModule.kt");
  let source = fs.readFileSync(widget, "utf8");
  if (!source.includes("saveBtn.setTextColor(trimmerColor)")) {
    if (!source.includes("cancelBtn.setTextColor(iconColor)")) throw new Error("Review the KampusOne video editor patch after upgrading video-trim.");
    source = source.replace("cancelBtn.setTextColor(iconColor)", "cancelBtn.setTextColor(iconColor)\n    saveBtn.setTextColor(trimmerColor)");
    fs.writeFileSync(widget, source);
  }
  source = fs.readFileSync(modulePath, "utf8");
  if (source.includes("// KampusOne branded trim progress")) return;
  const marker = "    // Create the parent layout for the dialog";
  if (!source.includes(marker) || !source.includes('it.progressTintList = ColorStateList.valueOf("#2196F3".toColorInt())')) throw new Error("Review the KampusOne video progress patch after upgrading video-trim.");
  source = source.replace(marker, `    // KampusOne branded trim progress
    val density = activity.resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()
    val dark = editorConfig?.getString("theme") == "dark"
    val surface = if (dark) "#171717".toColorInt() else Color.WHITE
    val ink = if (dark) Color.WHITE else "#201A17".toColorInt()
    val brand = if (editorConfig?.hasKey("trimmerColor") == true) editorConfig!!.getInt("trimmerColor") else "#8B3F2B".toColorInt()
    // Create the parent layout for the dialog`);
  source = source.replace("layout.setPadding(16, 32, 16, 32)", `layout.setPadding(dp(24), dp(26), dp(24), dp(16))
    layout.background = android.graphics.drawable.GradientDrawable().apply {
      setColor(surface)
      cornerRadius = dp(24).toFloat()
    }`);
  source = source.replace("    layout.addView(textView)\n\n    // Create and add the ProgressBar", `    textView.setTextColor(ink)
    textView.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    layout.addView(textView)
    val detail = TextView(activity).apply {
      text = "Your clip is almost ready"
      textSize = 13f
      setTextColor(ink)
      alpha = 0.68f
      gravity = Gravity.CENTER
      setPadding(0, dp(8), 0, dp(22))
    }
    layout.addView(detail)

    // Create and add the ProgressBar`);
  source = source.replace('it.progressTintList = ColorStateList.valueOf("#2196F3".toColorInt())', 'it.progressTintList = ColorStateList.valueOf(brand)\n      it.progressBackgroundTintList = ColorStateList.valueOf(if (dark) "#383838".toColorInt() else "#F0E5DE".toColorInt())\n      it.minimumHeight = dp(6)');
  source = source.replace('button.text = editorConfig?.getString("cancelTrimmingText")\n        ?: "Cancel Trimming"', 'button.text = "Cancel"\n      button.isAllCaps = false');
  source = source.replace(/button\.setTextColor\(\s*ContextCompat\.getColor\(\s*activity,\s*holo_red_light\s*\)\s*\)/, "button.setTextColor(brand)");
  source = source.replace("    mProgressDialog?.show()\n  }", `    mProgressDialog?.show()
    mProgressDialog?.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
    mProgressDialog?.window?.setLayout((activity.resources.displayMetrics.widthPixels * 0.88).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
  }`);
  fs.writeFileSync(modulePath, source);
}

module.exports = (config) => withDangerousMod(config, ["android", async (mod) => { patchVideoTrim(mod.modRequest.projectRoot); return mod; }]);
module.exports.patchVideoTrim = patchVideoTrim;
