// Build cache buster: 2026-01-25-v2
// Replaced by AppleBanner system — remove after verification
// import { Toaster } from "@/components/ui/toaster";
// import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { WarehouseProvider } from "@/contexts/WarehouseContext";
import { AppleBannerProvider } from "@/contexts/AppleBannerContext";
import { ToastBannerProvider } from "@/contexts/ToastBannerContext";
import { PromptProvider } from "@/components/prompts";
import { SubscriptionGateProvider, SubscriptionGatedRoute } from "@/components/subscription/SubscriptionGate";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequireRole } from "@/components/RequireRole";
import { ToastBanner } from "@/components/ui/ToastBanner";

/** All internal (non-client) roles that may access the main warehouse app. */
const INTERNAL_ROLES = ['admin', 'admin_dev', 'manager', 'warehouse', 'technician', 'billing_manager'];
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import SubscriptionUpdatePayment from "./pages/SubscriptionUpdatePayment";
import Inventory from "./pages/Inventory";
import ItemDetail from "./pages/ItemDetail";

import Reports from "./pages/Reports";
import Accounts from "./pages/Accounts";
import Settings from "./pages/Settings";
import Shipments from "./pages/Shipments";
import ShipmentsList from "./pages/ShipmentsList";
import ShipmentDetail from "./pages/ShipmentDetail";
import ShipmentCreate from "./pages/ShipmentCreate";
import OutboundCreate from "./pages/OutboundCreate";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Billing from "./pages/Billing";
import BillingReports from "./pages/BillingReports";
import BillingReport from "./pages/BillingReport";
import PromoCodes from "./pages/PromoCodes";
import Invoices from "./pages/Invoices";
import Employees from "./pages/Employees";
import Claims from "./pages/Claims";
import ClaimDetail from "./pages/ClaimDetail";
import CoverageQuickEntry from "./pages/CoverageQuickEntry";
import Stocktakes from "./pages/Stocktakes";
import StocktakeScanView from "./components/stocktakes/StocktakeScanView";
import StocktakeReport from "./components/stocktakes/StocktakeReport";
import Manifests from "./pages/Manifests";
import ManifestDetail from "./pages/ManifestDetail";
import ManifestScan from "./pages/ManifestScan";
import RepairTechAccess from "./pages/RepairTechAccess";
import TechQuoteSubmit from "./pages/TechQuoteSubmit";
import Technicians from "./pages/Technicians";
import RepairQuotes from "./pages/RepairQuotes";
import RepairQuoteDetail from "./pages/RepairQuoteDetail";
import Quotes from "./pages/Quotes";
import QuoteBuilder from "./pages/QuoteBuilder";
import QuoteAcceptance from "./pages/QuoteAcceptance";
import ClientQuoteReview from "./pages/ClientQuoteReview";
import ClientActivate from "./pages/ClientActivate";
import SmsOptIn from "./pages/SmsOptIn";
import SmsOptOut from "./pages/SmsOptOut";
import LandingPage from "./pages/LandingPage";
import SmsInfoPage from "./pages/SmsInfoPage";
import ClaimAcceptance from "./pages/ClaimAcceptance";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";
import ClientItems from "./pages/ClientItems";
import ClientQuotes from "./pages/ClientQuotes";
import ClientClaims from "./pages/ClientClaims";
import ClientShipments from "./pages/ClientShipments";
import ClientShipmentDetail from "./pages/ClientShipmentDetail";
import ClientInboundCreate from "./pages/ClientInboundCreate";
import ClientOutboundCreate from "./pages/ClientOutboundCreate";
import ClientTaskCreate from "./pages/ClientTaskCreate";
import ScanHub from "./pages/ScanHub";
import ScanItemRedirect from "./pages/ScanItemRedirect";
import ScanLocationRedirect from "./pages/ScanLocationRedirect";
import ScanContainerRedirect from "./pages/ScanContainerRedirect";
import ScanShipmentRedirect from "./pages/ScanShipmentRedirect";
import WarehouseMapBuilder from "./pages/WarehouseMapBuilder";
import WarehouseZones from "./pages/WarehouseZones";
import WarehouseHeatMap from "./pages/WarehouseHeatMap";
import PrintPreview from "./pages/PrintPreview";
import Diagnostics from "./pages/Diagnostics";
import BotQA from "./pages/admin/BotQA";
import StripeOps from "./pages/admin/StripeOps";
import PricingOps from "./pages/admin/PricingOps";
import SmsSenderOps from "./pages/admin/SmsSenderOps";
import BillingOverridesOps from "./pages/admin/BillingOverridesOps";
import EmailOps from "./pages/admin/EmailOps";
import AlertTemplateOps from "./pages/admin/AlertTemplateOps";
import HelpTool from "./pages/admin/HelpTool";
import QACenter from "./pages/QACenter";
// Removed: DecisionLedger — no longer a standalone page
import Messages from "./pages/Messages";
import ComponentsDemo from "./pages/ComponentsDemo";
import MaterialIconsSample from "./pages/MaterialIconsSample";
import LocationDetail from "./pages/LocationDetail";
import Containers from "./pages/Containers";
import ContainerDetail from "./pages/ContainerDetail";
import IncomingManager from "./pages/IncomingManager";
import InboundManifestDetail from "./pages/InboundManifestDetail";
import ExpectedShipmentDetail from "./pages/ExpectedShipmentDetail";
import DockIntakeReceiving from "./pages/DockIntakeReceiving";
import NotFound from "./pages/NotFound";
import { AIBotSwitch } from "./components/ai/AIBotSwitch";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {/* Replaced by AppleBanner system — remove after verification */}
      <BrowserRouter>
        <AppleBannerProvider>
        <ToastBannerProvider>
        <AuthProvider>
          <ImpersonationProvider>
          <WarehouseProvider>
          <PromptProvider>
          <SubscriptionGateProvider>
          <SidebarProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/welcome" element={<LandingPage />} />
            <Route path="/sms" element={<SmsInfoPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/subscription/update-payment" element={<ProtectedRoute><SubscriptionUpdatePayment /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Dashboard /></RequireRole></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Inventory /></RequireRole></ProtectedRoute>} />
            <Route path="/inventory/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ItemDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/locations/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><LocationDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/containers" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Containers /></RequireRole></ProtectedRoute>} />
            <Route path="/containers/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ContainerDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/warehouses/:warehouseId/map" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><WarehouseMapBuilder /></RequireRole></ProtectedRoute>} />
            <Route path="/warehouses/:warehouseId/zones" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><WarehouseZones /></RequireRole></ProtectedRoute>} />
            <Route path="/warehouses/:warehouseId/heatmap" element={<ProtectedRoute><RequireRole role={['admin', 'manager', 'warehouse']}><WarehouseHeatMap /></RequireRole></ProtectedRoute>} />
            {/* Incoming Manager (new inbound workflows) */}
            <Route path="/incoming/manager" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><IncomingManager /></RequireRole></ProtectedRoute>} />
            <Route path="/incoming" element={<Navigate to="/incoming/manager" replace />} />
            <Route path="/incoming/manifest/new" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><ShipmentCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/incoming/manifest/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><InboundManifestDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/incoming/expected/new" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><ShipmentCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/incoming/expected/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ExpectedShipmentDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/incoming/dock-intake/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><DockIntakeReceiving /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/shipments" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Shipments /></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/list" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ShipmentsList /></RequireRole></ProtectedRoute>} />
            {/* Legacy entry point: keep URL working but route to new Incoming Manager */}
            <Route path="/shipments/incoming" element={<Navigate to="/incoming/manager?tab=intakes" replace />} />
            <Route path="/shipments/outbound" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ShipmentsList /></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/received" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ShipmentsList /></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/released" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ShipmentsList /></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/new" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><ShipmentCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/create" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><ShipmentCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/return/new" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><ShipmentCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/outbound/new" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><SubscriptionGatedRoute><OutboundCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/shipments/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ShipmentDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/tasks" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Tasks /></RequireRole></ProtectedRoute>} />
            <Route path="/tasks/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><TaskDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/scan" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ScanHub /></RequireRole></ProtectedRoute>} />
            <Route path="/scan/item/:codeOrId" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ScanItemRedirect /></RequireRole></ProtectedRoute>} />
            <Route path="/scan/location/:codeOrId" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ScanLocationRedirect /></RequireRole></ProtectedRoute>} />
            <Route path="/scan/container/:codeOrId" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ScanContainerRedirect /></RequireRole></ProtectedRoute>} />
            <Route path="/scan/shipment/:numberOrId" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ScanShipmentRedirect /></RequireRole></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Messages /></RequireRole></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><Billing /></RequireRole></ProtectedRoute>} />
            <Route path="/billing/reports" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><BillingReports /></RequireRole></ProtectedRoute>} />
            <Route path="/billing/report" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><BillingReport /></RequireRole></ProtectedRoute>} />
            <Route path="/billing/invoices" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><Invoices /></RequireRole></ProtectedRoute>} />
            <Route path="/billing/promo-codes" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><PromoCodes /></RequireRole></ProtectedRoute>} />
            <Route path="/claims" element={<ProtectedRoute><RequireRole role="admin"><Claims /></RequireRole></ProtectedRoute>} />
            <Route path="/claims/:id" element={<ProtectedRoute><RequireRole role="admin"><ClaimDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/coverage" element={<ProtectedRoute><RequireRole role="admin"><CoverageQuickEntry /></RequireRole></ProtectedRoute>} />
            <Route path="/stocktakes" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Stocktakes /></RequireRole></ProtectedRoute>} />
            <Route path="/stocktakes/:id/scan" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><StocktakeScanView /></RequireRole></ProtectedRoute>} />
            <Route path="/stocktakes/:id/report" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><StocktakeReport /></RequireRole></ProtectedRoute>} />
            <Route path="/manifests" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Manifests /></RequireRole></ProtectedRoute>} />
            <Route path="/manifests/:id" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ManifestDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/manifests/:id/scan" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ManifestScan /></RequireRole></ProtectedRoute>} />
            <Route path="/manifests/:id/history" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><ManifestDetail /></RequireRole></ProtectedRoute>} />

            <Route path="/reports" element={<ProtectedRoute><RequireRole role={INTERNAL_ROLES}><Reports /></RequireRole></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><Accounts /></RequireRole></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><Employees /></RequireRole></ProtectedRoute>} />
            <Route path="/technicians" element={<ProtectedRoute><RequireRole role="admin"><Technicians /></RequireRole></ProtectedRoute>} />
            <Route path="/repair-quotes" element={<ProtectedRoute><RequireRole role="admin"><RepairQuotes /></RequireRole></ProtectedRoute>} />
            <Route path="/repair-quotes/:id" element={<ProtectedRoute><RequireRole role="admin"><RepairQuoteDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/quotes" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><Quotes /></RequireRole></ProtectedRoute>} />
            <Route path="/quotes/new" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><QuoteBuilder /></RequireRole></ProtectedRoute>} />
            <Route path="/quotes/:id" element={<ProtectedRoute><RequireRole role={['admin', 'manager']}><QuoteBuilder /></RequireRole></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><RequireRole role={['admin', 'billing_manager']}><Settings /></RequireRole></ProtectedRoute>} />
            {/* QA/Dev tooling: allow system-level admin_dev access */}
            <Route path="/diagnostics" element={<ProtectedRoute><RequireRole role={['admin', 'admin_dev']}><Diagnostics /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/bot-qa" element={<ProtectedRoute><RequireRole role={['admin', 'admin_dev']}><BotQA /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/saas-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><Navigate to="/admin/stripe-ops" replace /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/stripe-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><StripeOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/pricing-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><PricingOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/sms-sender-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><SmsSenderOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/billing-overrides-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><BillingOverridesOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/email-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><EmailOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/alert-template-ops" element={<ProtectedRoute><RequireRole role={['admin_dev']}><AlertTemplateOps /></RequireRole></ProtectedRoute>} />
            <Route path="/admin/help-tool" element={<ProtectedRoute><RequireRole role={['admin_dev']}><HelpTool /></RequireRole></ProtectedRoute>} />
            <Route path="/qa" element={<ProtectedRoute><QACenter /></ProtectedRoute>} />
            {/* Removed: /decision-ledger route */}
            <Route path="/repair-access" element={<RepairTechAccess />} />
            <Route path="/quote/tech" element={<TechQuoteSubmit />} />
            <Route path="/quote/review" element={<ClientQuoteReview />} />
            <Route path="/claim/accept/:token" element={<ClaimAcceptance />} />
            <Route path="/quote/accept" element={<QuoteAcceptance />} />
            <Route path="/activate" element={<ClientActivate />} />
            <Route path="/sms-opt-in" element={<SmsOptIn />} />
            <Route path="/sms-opt-in/:tenantId" element={<SmsOptIn />} />
            <Route path="/sms-opt-out" element={<SmsOptOut />} />
            <Route path="/sms-opt-out/:tenantId" element={<SmsOptOut />} />
            <Route path="/sms/opt-in" element={<SmsOptIn />} />
            <Route path="/sms/opt-in/:tenantId" element={<SmsOptIn />} />
            <Route path="/sms/opt-out" element={<SmsOptOut />} />
            <Route path="/sms/opt-out/:tenantId" element={<SmsOptOut />} />
            <Route path="/client/login" element={<ClientLogin />} />
            <Route path="/client" element={<ProtectedRoute><RequireRole role="client_user"><ClientDashboard /></RequireRole></ProtectedRoute>} />
            <Route path="/client/items" element={<ProtectedRoute><RequireRole role="client_user"><ClientItems /></RequireRole></ProtectedRoute>} />
            <Route path="/client/quotes" element={<ProtectedRoute><RequireRole role="client_user"><ClientQuotes /></RequireRole></ProtectedRoute>} />
            <Route path="/client/shipments" element={<ProtectedRoute><RequireRole role="client_user"><ClientShipments /></RequireRole></ProtectedRoute>} />
            <Route path="/client/shipments/new" element={<ProtectedRoute><RequireRole role="client_user"><SubscriptionGatedRoute><ClientInboundCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/client/shipments/outbound/new" element={<ProtectedRoute><RequireRole role="client_user"><SubscriptionGatedRoute><ClientOutboundCreate /></SubscriptionGatedRoute></RequireRole></ProtectedRoute>} />
            <Route path="/client/shipments/:id" element={<ProtectedRoute><RequireRole role="client_user"><ClientShipmentDetail /></RequireRole></ProtectedRoute>} />
            <Route path="/client/tasks/new" element={<ProtectedRoute><RequireRole role="client_user"><ClientTaskCreate /></RequireRole></ProtectedRoute>} />
            <Route path="/client/claims" element={<ProtectedRoute><RequireRole role="client_user"><ClientClaims /></RequireRole></ProtectedRoute>} />
            <Route path="/components-demo" element={<ProtectedRoute><ComponentsDemo /></ProtectedRoute>} />
            <Route path="/material-icons" element={<ProtectedRoute><MaterialIconsSample /></ProtectedRoute>} />
            <Route path="/print-preview" element={<PrintPreview />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <AIBotSwitch />
          <ToastBanner />
          </SidebarProvider>
          </SubscriptionGateProvider>
          </PromptProvider>
          </WarehouseProvider>
          </ImpersonationProvider>
        </AuthProvider>
        </ToastBannerProvider>
        </AppleBannerProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
