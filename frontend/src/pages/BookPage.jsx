import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTurf } from '../context/TurfContext';
import { slotApi } from '../api/slotApi';
import { bookingApi } from '../api/bookingApi';
import RazorpayModal from '../components/RazorpayModal';
import {
  Calendar as CalendarIcon,
  Clock,
  ShieldCheck,
  Zap,
  Check,
  AlertCircle,
  Sparkles,
  Info,
  Layers,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';

const BookPage = () => {
  const { user } = useAuth();
  const { turf } = useTurf();
  const navigate = useNavigate();

  // Date States (default to today)
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Slots State
  const [slotsData, setSlotsData] = useState({ slots: [], availableSlotsCount: 0 });
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [durationHours, setDurationHours] = useState(1);

  // Customer Details Form State
  const [customerDetails, setCustomerDetails] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    sport: 'Football (5v5)',
    notes: '',
  });

  // Booking & Payment Flow State
  const [submitting, setSubmitting] = useState(false);
  const [holdData, setHoldData] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Auto-sync user if logged in
  useEffect(() => {
    if (user) {
      setCustomerDetails((prev) => ({
        ...prev,
        name: prev.name || user.name,
        email: prev.email || user.email,
        phone: prev.phone || user.phone,
      }));
    }
  }, [user]);

  // Fetch slots whenever selectedDate changes
  const fetchSlots = async (dateStr) => {
    try {
      setLoadingSlots(true);
      setSelectedSlot(null);
      setDurationHours(1);
      setErrorMessage(null);
      const res = await slotApi.getSlotsForDate(dateStr);
      if (res.success && res.data) {
        setSlotsData(res.data);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load slots for this date');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlots(selectedDate);
  }, [selectedDate]);

  // 14-Day quick date ribbon
  const dateRibbon = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateString = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNumber = d.getDate();
    const monthName = d.toLocaleDateString('en-US', { month: 'short' });
    const isToday = i === 0;

    return {
      dateString,
      dayName,
      dayNumber,
      monthName,
      isToday,
    };
  });

  // Slot bucketing by category
  const categories = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const categorizedSlots = categories.reduce((acc, cat) => {
    acc[cat] = slotsData.slots?.filter((s) => s.category === cat) || [];
    return acc;
  }, {});

  // Compute Multi-Hour selection details
  const multiHourDetails = useMemo(() => {
    if (!selectedSlot || !slotsData.slots) return null;

    const allSlots = slotsData.slots;
    const startIndex = allSlots.findIndex((s) => s.startTime === selectedSlot.startTime);
    if (startIndex === -1) return null;

    const selectedConsecutive = [];
    let totalAmount = 0;

    for (let i = 0; i < durationHours; i++) {
      const slot = allSlots[startIndex + i];
      if (slot && slot.status === 'AVAILABLE') {
        selectedConsecutive.push(slot);
        totalAmount += slot.price || turf?.defaultPrice || 800;
      } else {
        break;
      }
    }

    // Check if full requested duration is available
    const isDurationAvailable = selectedConsecutive.length === durationHours;
    const maxConsecutive = selectedSlot.maxConsecutiveHours || 1;

    // Calculate advance
    const advancePercent = turf?.advanceValue || 30;
    let advanceAmount = 0;
    if (turf?.advanceType === 'fixed') {
      advanceAmount = Math.min((turf?.advanceValue || 300) * durationHours, totalAmount);
    } else {
      advanceAmount = Math.round((totalAmount * advancePercent) / 100);
    }

    const remainingAmount = totalAmount - advanceAmount;
    const endTime = selectedConsecutive[selectedConsecutive.length - 1]?.endTime || selectedSlot.endTime;

    return {
      selectedConsecutive,
      isDurationAvailable,
      maxConsecutive,
      totalAmount,
      advanceAmount,
      remainingAmount,
      endTime,
      label: `${selectedSlot.startTime} - ${endTime} (${durationHours} ${durationHours === 1 ? 'Hour' : 'Hours'})`,
    };
  }, [selectedSlot, durationHours, slotsData.slots, turf]);

  // Handle Slot Hold submission
  const handleProceedToPayment = async (e) => {
    e.preventDefault();
    if (!selectedSlot) {
      setErrorMessage('Please select a start time slot.');
      return;
    }

    if (!multiHourDetails?.isDurationAvailable) {
      setErrorMessage(`The requested ${durationHours}-hour duration is not fully available. Please select a shorter duration.`);
      return;
    }

    if (!customerDetails.name || !customerDetails.email || !customerDetails.phone) {
      setErrorMessage('Please fill in your name, email, and mobile number to confirm your booking.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        date: selectedDate,
        startTime: selectedSlot.startTime,
        durationHours,
        sport: customerDetails.sport,
        customerDetails: {
          name: customerDetails.name,
          email: customerDetails.email,
          phone: customerDetails.phone,
          notes: customerDetails.notes,
        },
      };

      const res = await bookingApi.holdSlot(payload);
      if (res.success && res.data) {
        setHoldData(res.data);
        setShowPaymentModal(true);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Slot is no longer available. Please choose another time.');
      fetchSlots(selectedDate);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = (confirmedBooking) => {
    console.log(
      '[BookPage] Payment confirmation response:',
      confirmedBooking
    );

    setShowPaymentModal(false);

    const bookingId =
      confirmedBooking?.id ||
      confirmedBooking?.bookingId ||
      confirmedBooking?.bookingNumber;

    if (!bookingId) {
      console.error(
        '[BookPage] Payment succeeded but no booking identifier was returned:',
        confirmedBooking
      );

      navigate('/booking/confirmation');
      return;
    }

    navigate(`/booking/confirmation/${bookingId}`);
  };

  const handlePaymentFailure = (reason) => {
    setErrorMessage(`Payment incomplete: ${reason}. Please try again.`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="pitch-badge bg-pitch-950 text-pitch-400 border border-pitch-800">
              Live Pitch Schedule
            </span>
            <span className="text-xs text-slate-400">
              {slotsData.availableSlotsCount} Slots Available for {selectedDate}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white font-display mt-1">
            Book Your Match Pitch
          </h1>
        </div>

        {/* Custom Date Input for extended future booking */}
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-pitch-400" />
          <input
            type="date"
            min={todayStr}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-slate-900 text-slate-200 border border-slate-700/80 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pitch-500"
          />
        </div>
      </div>

      {/* 14-Day Quick Date Ribbon */}
      <div className="relative">
        <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
          {dateRibbon.map((item) => {
            const isSelected = selectedDate === item.dateString;
            return (
              <button
                key={item.dateString}
                onClick={() => setSelectedDate(item.dateString)}
                className={`shrink-0 w-20 py-3 px-2 rounded-2xl border text-center transition-all duration-200 ${isSelected
                    ? 'bg-gradient-to-b from-pitch-600 to-pitch-700 border-pitch-400 text-white shadow-lg shadow-pitch-900/50 scale-105'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{item.dayName}</p>
                <p className="text-xl font-black my-0.5 font-display">{item.dayNumber}</p>
                <p className="text-[10px] font-medium opacity-90">{item.monthName}</p>
                {item.isToday && (
                  <span className={`block text-[9px] font-extrabold uppercase mt-1 rounded-full py-0.5 ${isSelected ? 'bg-white text-pitch-800' : 'bg-pitch-950 text-pitch-400'}`}>
                    Today
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error notification */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Unable to proceed</p>
            <p className="text-xs text-red-300/90">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Main Grid: Left Slot Selector (2/3) + Right Customer Form (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT: Live Slot Grid (8 cols) */}
        <div className="lg:col-span-8 space-y-8">
          {loadingSlots ? (
            <div className="py-24 text-center space-y-3 glass-card">
              <div className="w-10 h-10 border-4 border-pitch-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-400">Loading real-time pitch availability...</p>
            </div>
          ) : (
            categories.map((category) => {
              const catSlots = categorizedSlots[category] || [];
              if (catSlots.length === 0) return null;

              return (
                <div key={category} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-pitch-400" />
                      {category} Slots
                    </h3>
                    <span className="text-xs text-slate-400">
                      {category === 'Morning' && '06:00 AM – 12:00 PM'}
                      {category === 'Afternoon' && '12:00 PM – 05:00 PM'}
                      {category === 'Evening' && '05:00 PM – 09:00 PM (Prime)'}
                      {category === 'Night' && '09:00 PM – 11:00 PM'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {catSlots.map((slot) => {
                      const isSelected = selectedSlot?.startTime === slot.startTime;
                      const isAvailable = slot.status === 'AVAILABLE';
                      const isHeld = slot.status === 'HELD';
                      const isBooked = slot.status === 'BOOKED';
                      const isBlocked = slot.status === 'BLOCKED';
                      const isPast = slot.status === 'PAST';

                      return (
                        <button
                          key={slot.startTime}
                          disabled={!isAvailable}
                          onClick={() => {
                            setSelectedSlot(slot);
                            setDurationHours(1);
                          }}
                          className={`relative p-3.5 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between h-28 ${isSelected
                              ? 'bg-gradient-to-br from-pitch-900 to-pitch-950 border-pitch-400 ring-2 ring-pitch-400/50 shadow-lg shadow-pitch-950/60 scale-[1.02]'
                              : isAvailable
                                ? 'bg-slate-900/90 border-slate-800 hover:border-pitch-500/60 hover:bg-slate-850 cursor-pointer'
                                : isHeld
                                  ? 'bg-amber-950/20 border-amber-500/40 opacity-75 cursor-not-allowed'
                                  : isBlocked
                                    ? 'bg-slate-900/40 border-dashed border-slate-800 opacity-60 cursor-not-allowed'
                                    : 'bg-slate-950/40 border-slate-900 opacity-40 cursor-not-allowed'
                            }`}
                        >
                          {/* Top Row: Time & Status Badge */}
                          <div className="flex items-start justify-between w-full">
                            <span className="text-xs font-bold text-white font-mono">
                              {slot.startTime}
                            </span>
                            {isAvailable && (
                              <span className="w-2 h-2 rounded-full bg-pitch-500 shadow-sm shadow-pitch-500/80" />
                            )}
                            {isHeld && (
                              <span className="text-[9px] font-bold text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800 animate-pulse">
                                Held
                              </span>
                            )}
                            {isBooked && (
                              <span className="text-[9px] font-bold text-red-400 bg-red-950/60 px-1.5 py-0.5 rounded border border-red-900">
                                Booked
                              </span>
                            )}
                            {isBlocked && (
                              <span className="text-[9px] font-bold text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
                                Blocked
                              </span>
                            )}
                            {isPast && (
                              <span className="text-[9px] font-medium text-slate-500">
                                Passed
                              </span>
                            )}
                          </div>

                          {/* Middle time range */}
                          <p className="text-[11px] text-slate-400 font-medium">
                            {slot.label}
                          </p>

                          {/* Bottom price tag */}
                          <div className="flex items-center justify-between w-full pt-1 border-t border-slate-800/60">
                            {isAvailable ? (
                              <>
                                <span className="text-xs font-extrabold text-white">₹{slot.price}</span>
                                <span className="text-[10px] font-bold text-pitch-400 bg-pitch-950 px-1.5 py-0.5 rounded border border-pitch-800/80">
                                  Adv ₹{slot.advanceAmount}
                                </span>
                              </>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">
                                {isBlocked ? slot.blockReason || 'Maintenance' : slot.status}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          {/* Slot Legend */}
          <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-slate-800/80 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-pitch-500/20 border border-pitch-500" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-amber-500/20 border border-amber-500" />
              Temporarily Held (10m)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-red-500/20 border border-red-800" />
              Booked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-md bg-slate-800 border border-dashed border-slate-700" />
              Blocked for Maintenance
            </span>
          </div>
        </div>

        {/* RIGHT: Multi-Hour Duration & Booking Form (4 cols) */}
        <div className="lg:col-span-4 sticky top-24 space-y-6">
          <div className="glass-card p-6 space-y-6 border-pitch-500/30">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-xl font-black text-white font-display">Booking Summary</h2>
              <p className="text-xs text-slate-400 mt-0.5">Arena Sports Turf • Multi-Hour Booking</p>
            </div>

            {/* Selected Slot & Multi-Hour Duration Selector */}
            {selectedSlot ? (
              <div className="space-y-4">
                {/* Duration Buttons */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-pitch-400" />
                    Select Match Duration
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((hours) => {
                      const isDurationPossible = (selectedSlot.maxConsecutiveHours || 1) >= hours;
                      const isCurrentDuration = durationHours === hours;

                      return (
                        <button
                          key={hours}
                          type="button"
                          disabled={!isDurationPossible}
                          onClick={() => setDurationHours(hours)}
                          className={`py-2.5 rounded-xl text-xs font-bold transition-all border ${isCurrentDuration
                              ? 'bg-gradient-to-r from-pitch-600 to-pitch-500 text-white border-pitch-400 shadow-md scale-105'
                              : isDurationPossible
                                ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                                : 'bg-slate-950/40 text-slate-600 border-slate-900 cursor-not-allowed'
                            }`}
                        >
                          {hours} {hours === 1 ? 'Hour' : 'Hours'}
                        </button>
                      );
                    })}
                  </div>
                  {selectedSlot.maxConsecutiveHours < 4 && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Max {selectedSlot.maxConsecutiveHours} consecutive available {selectedSlot.maxConsecutiveHours === 1 ? 'hour' : 'hours'} from this start time.
                    </p>
                  )}
                </div>

                {/* Match Summary Box */}
                <div className="p-4 rounded-xl bg-pitch-950/40 border border-pitch-500/40 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Date:</span>
                    <span className="font-bold text-white">{selectedDate}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Start Time:</span>
                    <span className="font-bold text-white">{selectedSlot.startTime}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">End Time:</span>
                    <span className="font-bold text-pitch-300">{multiHourDetails?.endTime}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Total Duration:</span>
                    <span className="font-extrabold text-pitch-400">
                      {durationHours} {durationHours === 1 ? 'Hour' : 'Hours'} ({durationHours * 60} mins)
                    </span>
                  </div>

                  {/* Hourly Breakdown */}
                  {durationHours > 1 && multiHourDetails?.selectedConsecutive && (
                    <div className="pt-2 border-t border-pitch-800/60 space-y-1 text-[11px]">
                      <p className="text-slate-400 font-semibold mb-1">Hourly Breakdown:</p>
                      {multiHourDetails.selectedConsecutive.map((s, idx) => (
                        <div key={idx} className="flex justify-between text-slate-300">
                          <span>
                            {s.startTime}–{s.endTime} ({s.appliedRule || 'Standard'})
                          </span>
                          <span className="font-mono text-white">₹{s.price}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center py-6 text-xs text-slate-400">
                <Clock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <span>Select an available start time from the schedule.</span>
              </div>
            )}

            {/* Customer Information Inputs */}
            <form onSubmit={handleProceedToPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Sport Type
                </label>
                <select
                  value={customerDetails.sport}
                  onChange={(e) => setCustomerDetails({ ...customerDetails, sport: e.target.value })}
                  className="input-field text-sm"
                >
                  <option value="Football (5v5)">⚽ Football (5v5)</option>
                  <option value="Football (7v7)">⚽ Football (7v7)</option>
                  <option value="Box Cricket">🏏 Box Cricket</option>
                  <option value="Badminton">🏸 Badminton</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={customerDetails.name}
                  onChange={(e) => setCustomerDetails({ ...customerDetails, name: e.target.value })}
                  className="input-field text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mobile Number (for Match Pass SMS/WhatsApp) *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9841234567"
                  value={customerDetails.phone}
                  onChange={(e) => setCustomerDetails({ ...customerDetails, phone: e.target.value })}
                  className="input-field text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. rahul@example.com"
                  value={customerDetails.email}
                  onChange={(e) => setCustomerDetails({ ...customerDetails, email: e.target.value })}
                  className="input-field text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Special Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Need football bibs, extra balls"
                  value={customerDetails.notes}
                  onChange={(e) => setCustomerDetails({ ...customerDetails, notes: e.target.value })}
                  className="input-field text-sm"
                />
              </div>

              {/* Price Breakdown */}
              {selectedSlot && multiHourDetails && (
                <div className="pt-4 border-t border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>Total Match Price ({durationHours} {durationHours === 1 ? 'Hour' : 'Hours'})</span>
                    <span className="font-bold text-white text-sm">₹{multiHourDetails.totalAmount}</span>
                  </div>
                  <div className="flex justify-between text-pitch-400 font-bold">
                    <span>Advance to Pay Online Now ({turf?.advanceValue || 30}%)</span>
                    <span className="text-sm">₹{multiHourDetails.advanceAmount}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-800/80">
                    <span>Balance Due at Pitch</span>
                    <span className="font-bold text-amber-400 text-sm">₹{multiHourDetails.remainingAmount}</span>
                  </div>
                </div>
              )}

              {/* Payment CTA */}
              <button
                type="submit"
                disabled={!selectedSlot || submitting || !multiHourDetails?.isDurationAvailable}
                className="btn-primary w-full py-4 text-sm font-bold shadow-lg shadow-pitch-900/60"
              >
                {submitting ? (
                  'Holding Slots...'
                ) : selectedSlot ? (
                  `Pay Advance ₹${multiHourDetails?.advanceAmount} via Razorpay`
                ) : (
                  'Select Start Time to Continue'
                )}
              </button>

              <p className="text-[11px] text-slate-500 text-center flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-pitch-500" />
                100% Refundable up to 24 hours prior
              </p>
            </form>
          </div>
        </div>
      </div>

      {/* Razorpay Payment / Test Simulator Modal */}
      {showPaymentModal && holdData && (
        <RazorpayModal
          holdData={holdData}
          onPaymentSuccess={handlePaymentSuccess}
          onPaymentFailure={handlePaymentFailure}
          onClose={() => setShowPaymentModal(false)}
        />
      )}
    </div>
  );
};

export default BookPage;
