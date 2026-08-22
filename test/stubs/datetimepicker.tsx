// @react-native-community/datetimepicker ships untranspiled Flow, which
// Vitest cannot parse. Component tests care that TimeField renders and
// reports a value, not how the platform picker paints — Playwright's
// visual layer covers that.
export default function DateTimePicker() {
  return null;
}
