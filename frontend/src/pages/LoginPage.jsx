import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, Shield, User, AlertCircle, Sparkles } from 'lucide-react';

const LoginPage = () => {
  const { login, loginAsDemoAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const from = location.state?.from?.pathname || '/admin';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const user = await login(email, password);
      if (user.role === 'ADMIN') {
        navigate('/admin');
      } else {
        navigate(from);
      }
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAdmin = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginAsDemoAdmin();
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="glass-card max-w-md w-full p-8 space-y-6 border-pitch-500/30">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pitch-500 to-pitch-700 flex items-center justify-center text-white mx-auto shadow-lg shadow-pitch-900/40">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-black text-white font-display">Welcome Back</h1>
          <p className="text-xs text-slate-400">Login to view match passes or manage turf operations</p>
        </div>

        {/* Demo Quick-Login Helpers */}
        <div className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider text-center">
            ⚡ Quick 1-Click Demo Login
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={handleDemoAdmin}
              disabled={loading}
              className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              <Shield className="w-3.5 h-3.5" />
              Owner (Admin)
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-10 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pl-10 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 text-sm font-bold mt-2"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  );
};

export default LoginPage;
