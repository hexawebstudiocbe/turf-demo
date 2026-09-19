import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTurf } from '../context/TurfContext';
import {
  Calendar,
  Phone,
  MessageSquare,
  Shield,
  User,
  LogOut,
  Menu,
  X,
  Clock,
  MapPin,
  Sparkles,
} from 'lucide-react';

const Navbar = () => {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const { turf } = useTurf();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  const handleLogout = () => {
    logout();
    navigate('/');
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/80">
      {/* Top micro bar for phone & quick status */}
      <div className="hidden md:flex items-center justify-between px-6 py-1.5 bg-gradient-to-r from-pitch-950/80 via-slate-900/80 to-pitch-950/80 border-b border-slate-800/40 text-xs text-slate-400">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5 text-pitch-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-pitch-500 animate-pulse" />
            Turf Open Today: {turf?.openingTime || '06:00 AM'} - {turf?.closingTime || '11:00 PM'}
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <MapPin className="w-3.5 h-3.5 text-slate-500" />
            {turf?.city || 'Coimbatore'}, {turf?.state || 'Tamil Nadu'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`tel:${turf?.contactPhone || '+919876543210'}`}
            className="flex items-center gap-1 hover:text-pitch-400 transition"
          >
            <Phone className="w-3 h-3 text-pitch-500" />
            {turf?.contactPhone || '+91 98765 43210'}
          </a>
          <a
            href={`https://wa.me/${turf?.whatsappNumber || '919876543210'}?text=Hi%20Arena%20Turf,%20I%20want%20to%20inquire%20about%20slot%20booking`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-pitch-400 transition"
          >
            <MessageSquare className="w-3 h-3 text-emerald-500" />
            WhatsApp Support
          </a>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pitch-500 to-pitch-700 flex items-center justify-center text-white shadow-lg shadow-pitch-900/40 group-hover:scale-105 transition-transform">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight font-display text-white">
                  Turf<span className="text-pitch-400">Book</span>
                </span>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-pitch-950 text-pitch-400 border border-pitch-800">
                  {turf?.name || 'Arena Turf'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 tracking-wide font-medium">FIFA-Grade 50mm Pitch</p>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            <Link
              to="/"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                isActive('/') ? 'text-pitch-400 bg-pitch-950/60' : 'text-slate-300 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              Home
            </Link>
            <Link
              to="/book"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition ${
                isActive('/book') ? 'text-pitch-400 bg-pitch-950/60' : 'text-slate-300 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              Book Slots
            </Link>
            <a
              href="/#facilities"
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-900/60 transition"
            >
              Facilities
            </a>
            <a
              href="/#pricing"
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-900/60 transition"
            >
              Pricing
            </a>
            <a
              href="/#location"
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-900/60 transition"
            >
              Location
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="hidden md:flex items-center gap-3">
            {isAdmin && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition"
              >
                <Shield className="w-3.5 h-3.5" />
                Admin Portal
              </Link>
            )}

            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-semibold text-white leading-tight">{user.name}</p>
                  <p className="text-[10px] text-slate-400">{user.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Logout"
                  className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  Admin Login
                </Link>
                <Link
                  to="/book"
                  className="btn-primary text-sm py-2 px-4 shadow-md"
                >
                  <Calendar className="w-4 h-4" />
                  Book Now
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center gap-2 md:hidden">
            <Link
              to="/book"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-pitch-500 text-white flex items-center gap-1"
            >
              <Calendar className="w-3.5 h-3.5" />
              Book
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-900/95 border-b border-slate-800 px-4 pt-3 pb-6 space-y-3">
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-base font-medium text-slate-200 hover:bg-slate-800"
          >
            Home
          </Link>
          <Link
            to="/book"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2 rounded-lg text-base font-medium text-pitch-400 bg-pitch-950/60"
          >
            Book Slots
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-lg text-base font-medium text-amber-400 bg-amber-950/40 border border-amber-800/50"
            >
              Admin Dashboard
            </Link>
          )}

          <div className="pt-3 border-t border-slate-800 space-y-2">
            {isAuthenticated ? (
              <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-xl">
                <div>
                  <p className="text-sm font-semibold text-white">{user.name}</p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 pt-2">
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-secondary text-center text-sm py-2 flex justify-center items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  Admin Login
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
