import { useLocation } from 'react-router';

/** Shows the router's current search string, so a test can read the URL. */
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
