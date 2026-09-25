import { useUser } from '../auth/AuthProvider';
import OperatorHome from './operator/OperatorHome';
import QualityBoard from './staff/QualityBoard';
import SupervisorFloor from './staff/SupervisorFloor';

/** Each role's home screen at /app. */
export default function Home() {
  const user = useUser();
  switch (user.role) {
    case 'operator':
      return <OperatorHome />;
    case 'supervisor':
      return <SupervisorFloor />;
    case 'quality':
      return <QualityBoard />;
  }
}
