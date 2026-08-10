import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { Dashboard } from './components/Dashboard';
import { Layout } from './components/Layout';
import { Drivers } from './pages/Drivers';
import { Users } from './pages/Users';
import { Rides } from './pages/Rides';
import { Payments } from './pages/Payments';
import { Settings } from './pages/Settings';
import { RecoverData } from './pages/RecoverData';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { Login } from './pages/Login';
import { Tasks } from './pages/Tasks';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/privacypolicy" element={<PrivacyPolicy />} />
        <Route path="/recoverData" element={<RecoverData />} />
        <Route path="/recoverdata" element={<RecoverData />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rides" element={<Rides />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="users" element={<Users />} />
          <Route path="payments" element={<Payments />} />
          <Route path="settings" element={<Settings />} />
          <Route path="tasks" element={<Tasks />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
