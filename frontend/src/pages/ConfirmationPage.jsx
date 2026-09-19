import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { bookingApi } from '../api/bookingApi';
import { useTurf } from '../context/TurfContext';
import PassCard from '../components/PassCard';
import ConfettiCelebration from '../components/ConfettiCelebration';
import { CheckCircle2, ArrowRight, Calendar, AlertCircle } from 'lucide-react';

const ConfirmationPage = () => {
  const { id } = useParams();
  const { turf } = useTurf();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        setLoading(true);
        const res = await bookingApi.getBookingById(id);
        if (res.success && res.data?.booking) {
          setBooking(res.data.booking);
        } else {
          setError('Booking not found');
        }
      } catch (err) {
        setError(err.message || 'Failed to load booking details');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchBooking();
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-pitch-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-md mx-auto my-20 p-8 glass-card text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Booking Not Found</h2>
        <p className="text-xs text-slate-400">{error || 'Could not locate this booking record.'}</p>
        <Link to="/" className="btn-primary text-sm py-2 px-6">
          Return Home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16 space-y-8">
      {/* Confetti Animation */}
      <ConfettiCelebration />

      {/* Success Banner */}
      <div className="text-center space-y-3 print:hidden">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pitch-500 to-emerald-700 text-white flex items-center justify-center mx-auto shadow-xl shadow-pitch-900/50">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <span className="pitch-badge bg-pitch-950 text-pitch-400 border border-pitch-800">
          Payment Verified & Confirmed
        </span>
        <h1 className="text-3xl sm:text-4xl font-black text-white font-display">
          Your Match Slot is Booked!
        </h1>
        <p className="text-sm text-slate-400 max-w-md mx-auto">
          We’ve reserved your pitch at <strong>{turf?.name || 'Arena Sports Turf'}</strong>. Show your QR pass at the entrance.
        </p>
      </div>

      {/* Pass Card with QR Code */}
      <PassCard booking={booking} turf={turf} />

      {/* Bottom Navigation */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 print:hidden">

        <Link to="/book" className="btn-primary text-sm py-3 px-6 w-full sm:w-auto text-center flex items-center justify-center gap-2">
          <Calendar className="w-4 h-4" />
          Book Another Slot
        </Link>
      </div>
    </div>
  );
};

export default ConfirmationPage;
