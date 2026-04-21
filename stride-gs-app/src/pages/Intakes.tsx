/**
 * Intakes — thin shell that redirects to the sub-tab inside Settings.
 *
 * The full intakes dashboard has been moved to
 * Settings → Clients → Intakes sub-tab (IntakesPanel component).
 * This route still exists so any bookmarked /#/intakes URLs redirect
 * gracefully rather than hitting a 404.
 *
 * The Navigate below uses `replace` so the back-button doesn't bounce
 * between the two routes.
 */
import { Navigate } from 'react-router-dom';

export function Intakes() {
  return <Navigate to="/settings?tab=clients&subtab=intakes" replace />;
}

export default Intakes;
