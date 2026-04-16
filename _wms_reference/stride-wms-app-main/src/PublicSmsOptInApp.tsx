import { BrowserRouter, Route, Routes } from "react-router-dom";
import SmsOptIn from "./pages/SmsOptIn";
import SmsOptOut from "./pages/SmsOptOut";
import SmsInfoPage from "./pages/SmsInfoPage";

/**
 * Public-only app shell for SMS preference flows.
 * This intentionally excludes AuthProvider and protected app chrome.
 */
export default function PublicSmsOptInApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sms" element={<SmsInfoPage />} />
        <Route path="/sms-opt-in" element={<SmsOptIn />} />
        <Route path="/sms-opt-in/:tenantId" element={<SmsOptIn />} />
        <Route path="/sms-opt-out" element={<SmsOptOut />} />
        <Route path="/sms-opt-out/:tenantId" element={<SmsOptOut />} />
        <Route path="/sms/opt-in" element={<SmsOptIn />} />
        <Route path="/sms/opt-in/:tenantId" element={<SmsOptIn />} />
        <Route path="/sms/opt-out" element={<SmsOptOut />} />
        <Route path="/sms/opt-out/:tenantId" element={<SmsOptOut />} />
      </Routes>
    </BrowserRouter>
  );
}
