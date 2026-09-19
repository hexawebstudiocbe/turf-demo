import React from 'react';
import { Routes, Route, Outlet, Link } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import BookPage from './pages/BookPage';
import ConfirmationPage from './pages/ConfirmationPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminBookingsPage from './pages/admin/AdminBookingsPage';
import AdminSlotsPage from './pages/admin/AdminSlotsPage';
import AdminPricingPage from './pages/admin/AdminPricingPage';
import AdminTurfPage from './pages/admin/AdminTurfPage';
import AdminCustomersPage from './pages/admin/AdminCustomersPage';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage';
import { AdminRoute } from './components/ProtectedRoute';

// Public Customer Layout wrapper
const PublicLayout = () => {
  return (
    <div className="min-h-screen flex flex-col justify-between">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

// 404 Component
const NotFoundPage = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="glass-card max-w-md w-full p-8 text-center space-y-4">
        <h1 className="text-4xl font-black text-pitch-400 font-display">404</h1>
        <h2 className="text-lg font-bold text-white">Page Not Found</h2>
        <p className="text-xs text-slate-400">The match pitch or page you are looking for does not exist.</p>
        <Link to="/" className="btn-primary text-xs py-2.5 px-6 inline-block">
          Return to Arena Turf
        </Link>
      </div>
    </div>
  );
};

function App() {
  return (
    <Routes>
      {/* Customer Routes */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/booking/confirmation/:id" element={<ConfirmationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Admin Dashboard Routes */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="bookings" element={<AdminBookingsPage />} />
        <Route path="slots" element={<AdminSlotsPage />} />
        <Route path="pricing" element={<AdminPricingPage />} />
        <Route path="turf" element={<AdminTurfPage />} />
        <Route path="customers" element={<AdminCustomersPage />} />
        <Route path="payments" element={<AdminPaymentsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
