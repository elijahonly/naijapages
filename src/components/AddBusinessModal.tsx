import React, { useState } from 'react';
import { useModal } from '../hooks/useModal';
import { 
  X, 
  Plus, 
  Building2, 
  MapPin, 
  Phone, 
  MessageCircle, 
  Globe, 
  Tag, 
  Sparkles, 
  Check,
  ShieldCheck,
  CreditCard,
  Clock,
  Calendar,
  AlertCircle,
  ExternalLink,
  HelpCircle,
  Hash,
  Share2,
  FileText,
  DollarSign,
  Compass,
  Loader2,
  Image as ImageIcon,
  Upload,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { CATEGORIES, STATES_DATA } from '../data/nigeriaData';
import type { Business } from '../types';
import { BusinessInput, ValidationError } from '../services/content';
import { deleteMediaFile, extractMediaKeyFromUrl, replaceMediaFile, uploadMediaFile } from '../services/media';
import { friendlyError } from '../lib/errors';
import { LIMITS } from '../lib/config';
import { safeGoogleMapsUrl } from '../lib/security';

interface AddBusinessModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves when the listing was saved; throw to show an error inside the form. */
  onAddBusiness: (input: BusinessInput) => Promise<void>;
  /** When supplied, edits this existing listing instead of creating a new one. */
  initialBusiness?: Business | null;
  onUpdateBusiness?: (id: string, input: BusinessInput) => Promise<void>;
}

const NIGERIAN_PAYMENT_OPTIONS = [
  'Bank Transfer',
  'POS / Card',
  'Cash',
  'USSD',
  'OPay / PalmPay',
  'Moniepoint',
  'Crypto / Stablecoins'
];

const COMMON_TAG_SUGGESTIONS = [
  'Standby Generator 24/7',
  'Ample Parking',
  'Air Conditioning',
  'Free Wi-Fi',
  'Nationwide Delivery',
  'Walk-ins Welcome',
  'POS Available',
  'CCTV Secured'
];

const AddBusinessForm: React.FC<AddBusinessModalProps> = ({
  onClose,
  onAddBusiness,
  initialBusiness,
  onUpdateBusiness,
}) => {
  useModal(onClose);
  const isEditing = Boolean(initialBusiness && onUpdateBusiness);
  const [submitting, setSubmitting] = useState(false);

  // Active step / section for navigation
  const [activeTab, setActiveTab] = useState<'basics' | 'location' | 'contact' | 'socials' | 'details'>('basics');

  // --- Form State ---
  const initStateName = initialBusiness?.state || 'Lagos';
  const initStateLgas = STATES_DATA.find((s) => s.name === initStateName)?.lgas ?? [];
  const initLgaInList = Boolean(initialBusiness?.lga && initStateLgas.includes(initialBusiness.lga));

  // Identity & Legal
  const [name, setName] = useState(initialBusiness?.name ?? '');
  const [category, setCategory] = useState(initialBusiness?.category ?? 'Tech');
  const [cacStatus, setCacStatus] = useState<'registered' | 'pending' | 'unregistered'>(
    initialBusiness?.cacStatus ?? (initialBusiness?.cacNumber ? 'registered' : isEditing ? 'unregistered' : 'registered'),
  );
  const [cacNumber, setCacNumber] = useState(initialBusiness?.cacNumber ?? '');
  const [yearEstablished, setYearEstablished] = useState<string>(
    initialBusiness?.yearEstablished ? String(initialBusiness.yearEstablished) : '',
  );

  // Location & Google Map (COMPULSORY)
  const [state, setState] = useState(initStateName);
  const [selectedLga, setSelectedLga] = useState(
    initLgaInList ? initialBusiness!.lga : (initStateLgas[0] ?? 'Ikeja'),
  );
  const [customLga, setCustomLga] = useState(
    initialBusiness?.lga && !initLgaInList ? initialBusiness.lga : '',
  );
  const [address, setAddress] = useState(initialBusiness?.address ?? '');
  const [landmark, setLandmark] = useState(initialBusiness?.landmark ?? '');
  const [googleMapUrl, setGoogleMapUrl] = useState(initialBusiness?.googleMapUrl ?? '');
  const [mapUrlError, setMapUrlError] = useState<string | null>(null);
  const [showMapHelp, setShowMapHelp] = useState(false);

  // Contact
  const [phone, setPhone] = useState(initialBusiness?.phone ?? '');
  const [secondaryPhone, setSecondaryPhone] = useState(initialBusiness?.secondaryPhone ?? '');
  const [whatsapp, setWhatsapp] = useState(initialBusiness?.whatsapp ?? '');
  const [email, setEmail] = useState(initialBusiness?.email ?? '');
  const [website, setWebsite] = useState(initialBusiness?.website ?? '');

  // Socials (Optional)
  const [instagram, setInstagram] = useState(initialBusiness?.socials?.instagram ?? '');
  const [twitter, setTwitter] = useState(initialBusiness?.socials?.twitter ?? '');
  const [facebook, setFacebook] = useState(initialBusiness?.socials?.facebook ?? '');
  const [linkedin, setLinkedin] = useState(initialBusiness?.socials?.linkedin ?? '');
  const [tiktok, setTiktok] = useState(initialBusiness?.socials?.tiktok ?? '');

  // Details & Operations
  const [openingHours, setOpeningHours] = useState(
    initialBusiness?.openingHours ?? 'Mon - Sat: 8:00 AM - 6:00 PM',
  );
  const [priceLevel, setPriceLevel] = useState<'₦' | '₦₦' | '₦₦₦' | '₦₦₦₦'>(
    (initialBusiness?.priceLevel as '₦' | '₦₦' | '₦₦₦' | '₦₦₦₦') || '₦₦',
  );
  const [selectedPayments, setSelectedPayments] = useState<string[]>(
    initialBusiness?.paymentMethods?.length
      ? initialBusiness.paymentMethods
      : ['Bank Transfer', 'POS / Card', 'Cash'],
  );
  const [description, setDescription] = useState(initialBusiness?.description ?? '');
  const [selectedTags, setSelectedTags] = useState<string[]>(
    initialBusiness?.tags?.length ? initialBusiness.tags : ['POS Available'],
  );
  const [customTagInput, setCustomTagInput] = useState('');

  // Branding & Photography (R2)
  const [logoUrl, setLogoUrl] = useState<string | undefined>(initialBusiness?.logoUrl);
  const [coverImageUrl, setCoverImageUrl] = useState<string | undefined>(initialBusiness?.coverImageUrl);
  const [gallery, setGallery] = useState<string[]>(initialBusiness?.gallery ?? []);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError(null);
    setUploadingSlot('logo');
    try {
      const existingKey = extractMediaKeyFromUrl(logoUrl);
      const media = existingKey
        ? await replaceMediaFile(existingKey, file, 'business_logo')
        : await uploadMediaFile({ file, purpose: 'business_logo' });
      setLogoUrl(media.url);
    } catch (err) {
      setMediaError(friendlyError(err, 'Could not upload business logo.'));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemoveLogo = async () => {
    const prev = logoUrl;
    setLogoUrl(undefined);
    if (prev && extractMediaKeyFromUrl(prev)) {
      await deleteMediaFile(prev).catch(() => {});
    }
  };

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMediaError(null);
    setUploadingSlot('cover');
    try {
      const existingKey = extractMediaKeyFromUrl(coverImageUrl);
      const media = existingKey
        ? await replaceMediaFile(existingKey, file, 'business_photo')
        : await uploadMediaFile({ file, purpose: 'business_photo' });
      setCoverImageUrl(media.url);
    } catch (err) {
      setMediaError(friendlyError(err, 'Could not upload cover photo.'));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemoveCover = async () => {
    const prev = coverImageUrl;
    setCoverImageUrl(undefined);
    if (prev && extractMediaKeyFromUrl(prev)) {
      await deleteMediaFile(prev).catch(() => {});
    }
  };

  const handleUploadGalleryFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = LIMITS.businessGallery - gallery.length;
    if (remainingSlots <= 0) {
      setMediaError(`Maximum of ${LIMITS.businessGallery} gallery photos allowed.`);
      return;
    }
    setMediaError(null);
    setUploadingSlot('gallery');
    try {
      const uploadedUrls: string[] = [];
      for (const file of files.slice(0, remainingSlots)) {
        const media = await uploadMediaFile({ file, purpose: 'business_gallery' });
        uploadedUrls.push(media.url);
      }
      setGallery((prev) => [...prev, ...uploadedUrls].slice(0, LIMITS.businessGallery));
    } catch (err) {
      setMediaError(friendlyError(err, 'Could not upload gallery photo.'));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleReplaceGalleryItem = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const currentUrl = gallery[idx];
    setMediaError(null);
    setUploadingSlot(`gallery-${idx}`);
    try {
      const existingKey = extractMediaKeyFromUrl(currentUrl);
      const media = existingKey
        ? await replaceMediaFile(existingKey, file, 'business_gallery')
        : await uploadMediaFile({ file, purpose: 'business_gallery' });
      setGallery((prev) => prev.map((u, i) => (i === idx ? media.url : u)));
    } catch (err) {
      setMediaError(friendlyError(err, 'Could not replace gallery photo.'));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemoveGalleryItem = async (idx: number) => {
    const target = gallery[idx];
    setGallery((prev) => prev.filter((_, i) => i !== idx));
    if (target && extractMediaKeyFromUrl(target)) {
      await deleteMediaFile(target).catch(() => {});
    }
  };

  const selectedStateObj = STATES_DATA.find((s) => s.name === state);
  const availableLgas = selectedStateObj ? selectedStateObj.lgas : [];

  const handleStateChange = (newState: string) => {
    setState(newState);
    const found = STATES_DATA.find((s) => s.name === newState);
    if (found && found.lgas.length > 0) {
      setSelectedLga(found.lgas[0]);
    } else {
      setSelectedLga('');
    }
  };

  const copyPhoneToWhatsApp = () => {
    if (phone.trim()) {
      setWhatsapp(phone.trim());
    }
  };

  const togglePayment = (method: string) => {
    if (selectedPayments.includes(method)) {
      setSelectedPayments(selectedPayments.filter((p) => p !== method));
    } else {
      setSelectedPayments([...selectedPayments, method]);
    }
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const addCustomTag = () => {
    const trimmed = customTagInput.trim().replace(/^#/, '');
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags([...selectedTags, trimmed]);
      setCustomTagInput('');
    }
  };

  // Google Maps URL validation (compulsory). Uses an exact host allow-list: a loose
  // `includes('google.')` check would also accept look-alikes such as google.evil.com.
  const validateGoogleMapUrl = (url: string): boolean => safeGoogleMapsUrl(url) !== undefined;

  const handleMapUrlBlur = () => {
    if (!googleMapUrl.trim()) {
      setMapUrlError('Google Maps link is compulsory. Please paste your Google Maps link.');
    } else if (!validateGoogleMapUrl(googleMapUrl)) {
      setMapUrlError('Please provide a valid Google Maps location link (e.g. https://maps.app.goo.gl/... or https://maps.google.com/...)');
    } else {
      setMapUrlError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Quick, friendly checks (the service layer and Worker API re-check everything).
    if (!name.trim()) {
      setActiveTab('basics');
      setFormError('Please provide the business name.');
      return;
    }

    if (cacStatus === 'registered' && !cacNumber.trim()) {
      setActiveTab('basics');
      setFormError('Enter your CAC registration number, or change the CAC status to "Pending" or "Unregistered".');
      return;
    }

    if (!address.trim()) {
      setActiveTab('location');
      setFormError('Please enter the street address.');
      return;
    }

    if (!googleMapUrl.trim()) {
      setActiveTab('location');
      setMapUrlError('Google Maps link is compulsory. Please paste your Google Maps link.');
      setFormError('Google Maps location link is compulsory for all listings to enable customer navigation.');
      return;
    }

    if (!validateGoogleMapUrl(googleMapUrl)) {
      setActiveTab('location');
      setMapUrlError('Please provide a valid Google Maps link (e.g. https://maps.app.goo.gl/...)');
      setFormError('The Google Maps link format is invalid.');
      return;
    }

    if (!phone.trim()) {
      setActiveTab('contact');
      setFormError('Please provide at least one active phone number for customer contact.');
      return;
    }

    const lgaFinal = customLga.trim() || selectedLga || 'Central Area';

    // Turn "@handle" entries into profile links; the service verifies each one points at the right site.
    const toProfileUrl = (val: string, platformBase: string) => {
      const clean = val.trim();
      if (!clean) return undefined;
      if (/^https?:\/\//i.test(clean)) return clean;
      return `${platformBase}${clean.replace(/^@/, '')}`;
    };

    const input: BusinessInput = {
      name: name.trim(),
      category,
      state,
      lga: lgaFinal,
      address: address.trim(),
      landmark: landmark.trim() || undefined,
      googleMapUrl: googleMapUrl.trim(),
      phone: phone.trim(),
      secondaryPhone: secondaryPhone.trim() || undefined,
      whatsapp: whatsapp.trim() || phone.trim(),
      email: email.trim() || undefined,
      website: website.trim() || undefined,
      cacStatus,
      cacNumber: cacNumber.trim() || undefined,
      yearEstablished: yearEstablished ? parseInt(yearEstablished, 10) : undefined,
      priceLevel,
      paymentMethods: selectedPayments,
      socials: {
        instagram: toProfileUrl(instagram, 'https://instagram.com/'),
        twitter: toProfileUrl(twitter, 'https://x.com/'),
        facebook: toProfileUrl(facebook, 'https://facebook.com/'),
        linkedin: toProfileUrl(linkedin, 'https://linkedin.com/in/'),
        tiktok: toProfileUrl(tiktok, 'https://tiktok.com/@'),
      },
      tags: selectedTags.length > 0 ? selectedTags : [category],
      openingHours: openingHours.trim() || 'Mon - Sat: 8:00 AM - 6:00 PM',
      description:
        description.trim() || `${name.trim()} is a ${category} business located in ${lgaFinal}, ${state} State.`,
      logoUrl,
      coverImageUrl,
      gallery,
    };

    setSubmitting(true);
    try {
      if (isEditing && initialBusiness && onUpdateBusiness) {
        await onUpdateBusiness(initialBusiness.id, input);
      } else {
        await onAddBusiness(input);
      }
      onClose();
    } catch (err) {
      setFormError(
        err instanceof ValidationError
          ? err.message
          : friendlyError(err, isEditing ? 'We could not update your listing. Please try again.' : 'We could not submit your listing. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-4 max-h-[94vh] flex flex-col"
        role="dialog" aria-modal="true" aria-label="List your business"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 text-white p-5 shrink-0 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shadow-inner">
                <Building2 className="w-6 h-6 text-emerald-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-extrabold text-lg sm:text-xl tracking-tight">
                    {isEditing ? 'Edit Business Listing' : 'Register Nigerian Business'}
                  </h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded border border-emerald-400/30">
                    {isEditing ? 'Owner Update' : 'Comprehensive Listing'}
                  </span>
                </div>
                <p className="text-xs text-emerald-100/90 mt-0.5">
                  {isEditing
                    ? 'Update your business information, hours, contact links, and photos.'
                    : 'Connect your business with millions of customers across all 36 States & FCT.'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 mt-4 overflow-x-auto pb-1 text-[11px] font-semibold no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('basics')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'basics'
                  ? 'bg-white text-emerald-900 font-bold shadow-sm'
                  : 'text-emerald-200 hover:bg-white/10'
              }`}
            >
              1. Business Info
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('location')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                activeTab === 'location'
                  ? 'bg-white text-emerald-900 font-bold shadow-sm'
                  : 'text-emerald-200 hover:bg-white/10'
              }`}
            >
              <span>2. Location & Maps</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'contact'
                  ? 'bg-white text-emerald-900 font-bold shadow-sm'
                  : 'text-emerald-200 hover:bg-white/10'
              }`}
            >
              3. Contacts
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('socials')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'socials'
                  ? 'bg-white text-emerald-900 font-bold shadow-sm'
                  : 'text-emerald-200 hover:bg-white/10'
              }`}
            >
              4. Social Handles
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('details')}
              className={`px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'details'
                  ? 'bg-white text-emerald-900 font-bold shadow-sm'
                  : 'text-emerald-200 hover:bg-white/10'
              }`}
            >
              5. Operations & Pricing
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {formError && (
          <div className="bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-900/60 p-3 px-5 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-rose-600" />
            <span className="font-medium">{formError}</span>
          </div>
        )}

        {!formError && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-900/60 py-2 px-5 text-emerald-800 dark:text-emerald-300 text-[11px] flex items-center gap-2">
            <ShieldCheck size={14} className="shrink-0" />
            <span>New listings are reviewed by our team before they appear in the directory. The Verified badge is added only after review.</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-slate-800 dark:text-slate-100">
          
          {/* TAB 1: BASICS & LEGAL */}
          {activeTab === 'basics' && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  Business Identity & CAC Status
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Provide verified corporate identity details for trust scoring.
                </p>
              </div>

              {/* Business Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Business / Enterprise Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Zenith Diagnostics Ltd, Eko Tech Works, Danladi Agro"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                />
              </div>

              {/* Category & Year */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Industry Sector / Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  >
                    {CATEGORIES.filter((c) => c.key !== 'All').map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.emoji} {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    Year Established
                  </label>
                  <input
                    type="number"
                    min="1960"
                    max={new Date().getFullYear()}
                    value={yearEstablished}
                    onChange={(e) => setYearEstablished(e.target.value)}
                    placeholder="e.g. 2018"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  />
                </div>
              </div>

              {/* CAC Status & RC Number */}
              <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Corporate Affairs Commission (CAC) Registration
                  </span>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded">
                    Boosts Trust Score
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      CAC Status
                    </label>
                    <select
                      value={cacStatus}
                      onChange={(e) => setCacStatus(e.target.value as any)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                    >
                      <option value="registered">Registered (RC / BN Number)</option>
                      <option value="pending">Registration in Progress</option>
                      <option value="unregistered">Sole Proprietor / Enterprise</option>
                    </select>
                  </div>

                  {cacStatus === 'registered' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        RC or BN Registration Number
                      </label>
                      <input
                        type="text"
                        value={cacNumber}
                        onChange={(e) => setCacNumber(e.target.value)}
                        placeholder="e.g. RC-1492042 or BN-293810"
                        className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white uppercase font-mono font-medium"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Business Logo, Cover Photo & Gallery (R2) */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-emerald-600" />
                    Business Logo, Cover Photo & Gallery
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">Optional · JPG/PNG/WebP</span>
                </div>

                {mediaError && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {mediaError}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Logo Upload */}
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                      <span>Business Logo (max 2 MB)</span>
                    </div>
                    {logoUrl ? (
                      <div className="flex items-center gap-2.5">
                        <img src={logoUrl} alt="Business logo preview" className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                        <div className="flex items-center gap-1.5">
                          <label className="px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer inline-flex items-center gap-1">
                            {uploadingSlot === 'logo' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            <span>Replace</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadLogo} />
                          </label>
                          <button type="button" onClick={handleRemoveLogo} aria-label="Remove logo" className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-emerald-500 cursor-pointer">
                        {uploadingSlot === 'logo' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        <span>{uploadingSlot === 'logo' ? 'Uploading…' : 'Upload Logo'}</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadLogo} />
                      </label>
                    )}
                  </div>

                  {/* Cover Photo Upload */}
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                      <span>Storefront Photo (max 5 MB)</span>
                    </div>
                    {coverImageUrl ? (
                      <div className="flex items-center gap-2.5">
                        <img src={coverImageUrl} alt="Storefront cover preview" className="w-16 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                        <div className="flex items-center gap-1.5">
                          <label className="px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer inline-flex items-center gap-1">
                            {uploadingSlot === 'cover' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            <span>Replace</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadCover} />
                          </label>
                          <button type="button" onClick={handleRemoveCover} aria-label="Remove cover photo" className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-emerald-500 cursor-pointer">
                        {uploadingSlot === 'cover' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        <span>{uploadingSlot === 'cover' ? 'Uploading…' : 'Upload Cover Photo'}</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadCover} />
                      </label>
                    )}
                  </div>
                </div>

                {/* Gallery Photos */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Gallery Photos ({gallery.length}/{LIMITS.businessGallery})
                    </span>
                    {gallery.length < LIMITS.businessGallery && (
                      <label className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer inline-flex items-center gap-1">
                        {uploadingSlot === 'gallery' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        <span>{uploadingSlot === 'gallery' ? 'Uploading…' : 'Add Gallery Photos'}</span>
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadGalleryFiles} />
                      </label>
                    )}
                  </div>
                  {gallery.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {gallery.map((photoUrl, idx) => (
                        <div key={`${photoUrl}-${idx}`} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 h-16 bg-slate-100 dark:bg-slate-800">
                          <img src={photoUrl} alt={`Gallery ${idx + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            <label title="Replace photo" className="p-1 bg-white/90 text-slate-900 rounded cursor-pointer">
                              {uploadingSlot === `gallery-${idx}` ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => handleReplaceGalleryItem(idx, e)} />
                            </label>
                            <button type="button" onClick={() => handleRemoveGalleryItem(idx)} aria-label={`Remove gallery photo ${idx + 1}`} className="p-1 bg-rose-600 text-white rounded cursor-pointer">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOCATION & GOOGLE MAPS (COMPULSORY) */}
          {activeTab === 'location' && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  Location & Google Map Pin
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ensure customers can easily navigate directly to your storefront, office, or facility.
                </p>
              </div>

              {/* State & LGA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    State (36 States + FCT) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={state}
                    onChange={(e) => handleStateChange(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  >
                    {STATES_DATA.map((st) => (
                      <option key={st.key} value={st.name}>
                        {st.name} ({st.capital})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Local Government Area (LGA) <span className="text-rose-500">*</span>
                  </label>
                  {availableLgas.length > 0 ? (
                    <select
                      value={selectedLga}
                      onChange={(e) => setSelectedLga(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                    >
                      {availableLgas.map((lga) => (
                        <option key={lga} value={lga}>
                          {lga}
                        </option>
                      ))}
                      <option value="Other">Other / Industrial Estate</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={customLga}
                      onChange={(e) => setCustomLga(e.target.value)}
                      placeholder="e.g. Central Business District"
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                    />
                  )}
                </div>
              </div>

              {selectedLga === 'Other' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Specify Custom LGA / Industrial Zone
                  </label>
                  <input
                    type="text"
                    value={customLga}
                    onChange={(e) => setCustomLga(e.target.value)}
                    placeholder="Enter district or estate name"
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              )}

              {/* Physical Street Address */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Physical Street Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Plot 14 Admiralty Way, Lekki Phase 1 / Suite 12 Grand Square Mall"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                />
              </div>

              {/* Nearest Landmark */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-amber-500" />
                  Popular Landmark / Nearest Bus Stop (Recommended)
                </label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="e.g. Opposite Guaranty Trust Bank, beside Ikeja Bus Stop, near Total Energies"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                />
              </div>

              {/* GOOGLE MAPS LINK - COMPULSORY */}
              <div className="p-4 bg-amber-50/80 dark:bg-amber-950/30 rounded-2xl border-2 border-amber-300 dark:border-amber-700/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5 uppercase tracking-wide">
                    <MapPin className="w-4 h-4 text-amber-600 dark:text-amber-400 fill-amber-500/20" />
                    Google Maps Location Link <span className="text-rose-600 font-black text-sm">* (COMPULSORY)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowMapHelp(!showMapHelp)}
                    className="text-[11px] text-amber-800 dark:text-amber-300 underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle size={13} />
                    <span>How to get link</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="url"
                    required
                    value={googleMapUrl}
                    onChange={(e) => {
                      setGoogleMapUrl(e.target.value);
                      if (mapUrlError) setMapUrlError(null);
                    }}
                    onBlur={handleMapUrlBlur}
                    placeholder="https://maps.app.goo.gl/... or https://maps.google.com/..."
                    className={`w-full pl-3.5 pr-20 py-2.5 text-sm bg-white dark:bg-slate-800 border rounded-xl outline-none font-mono text-slate-900 dark:text-white transition-colors ${
                      mapUrlError
                        ? 'border-rose-500 focus:ring-2 focus:ring-rose-500/30'
                        : 'border-amber-300 dark:border-amber-700 focus:border-emerald-600'
                    }`}
                  />

                  {safeGoogleMapsUrl(googleMapUrl) && (
                    <a
                      href={safeGoogleMapsUrl(googleMapUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute right-2 top-2 px-2.5 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex items-center gap-1 shadow-sm transition"
                      title="Test your Google Maps link"
                    >
                      <span>Test</span>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>

                {mapUrlError && (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertCircle size={13} />
                    <span>{mapUrlError}</span>
                  </p>
                )}

                {showMapHelp && (
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-900 text-xs text-slate-700 dark:text-slate-300 space-y-1.5 animate-fade-in">
                    <p className="font-bold text-amber-900 dark:text-amber-300">How to get your Google Maps share link:</p>
                    <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      <li>Open the <strong>Google Maps app</strong> or visit <strong>maps.google.com</strong>.</li>
                      <li>Search for your business name or tap and hold on your exact shop/office location.</li>
                      <li>Tap the <strong>Share</strong> button.</li>
                      <li>Select <strong>Copy to clipboard</strong> and paste the link here.</li>
                    </ol>
                  </div>
                )}

                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                  A verified Google Maps link enables customers on NaijaPages to get turn-by-turn navigation directly to your premises.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: CONTACTS */}
          {activeTab === 'contact' && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Phone className="w-4 h-4 text-emerald-600" />
                  Contact & Communication Channels
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Allow customers to call, WhatsApp, or email you directly without intermediaries.
                </p>
              </div>

              {/* Primary & Secondary Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    Primary Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08012345678 or +234..."
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    Secondary Phone / Landline (Optional)
                  </label>
                  <input
                    type="tel"
                    value={secondaryPhone}
                    onChange={(e) => setSecondaryPhone(e.target.value)}
                    placeholder="08098765432 or 01-2345678"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* WhatsApp */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                    WhatsApp Business Number
                  </label>
                  {phone.trim() && (
                    <button
                      type="button"
                      onClick={copyPhoneToWhatsApp}
                      className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                    >
                      Same as primary phone
                    </button>
                  )}
                </div>
                <input
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="08012345678 (Customers can 1-click chat)"
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                />
              </div>

              {/* Email & Website */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Official Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@mybusiness.ng"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-blue-500" />
                    Website URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://mybusiness.ng"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SOCIAL MEDIA HANDLES (OPTIONAL) */}
          {activeTab === 'socials' && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-emerald-600" />
                    Social Media Handles
                  </h3>
                  <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Connect your brand handles so prospective clients can review your catalog, portfolios, and reels.
                </p>
              </div>

              {/* Instagram */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <span className="text-rose-500 font-bold">IG</span>
                  Instagram Handle or Link
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="mybusinessng or https://instagram.com/mybusinessng"
                    className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* X / Twitter */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <span className="text-slate-900 dark:text-white font-bold">X</span>
                  X (formerly Twitter) Handle or Link
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="mybusinessng or https://x.com/mybusinessng"
                    className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Facebook & LinkedIn */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                    <span className="text-blue-600 font-bold">FB</span>
                    Facebook Page
                  </label>
                  <input
                    type="text"
                    value={facebook}
                    onChange={(e) => setFacebook(e.target.value)}
                    placeholder="facebook.com/mybusinessng"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                    <span className="text-blue-700 font-bold">in</span>
                    LinkedIn Page
                  </label>
                  <input
                    type="text"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="linkedin.com/company/mybusinessng"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* TikTok */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <span className="text-slate-900 dark:text-white font-bold">TT</span>
                  TikTok Handle
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    value={tiktok}
                    onChange={(e) => setTiktok(e.target.value)}
                    placeholder="mybusinessng"
                    className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: OPERATIONS & PRICING */}
          {activeTab === 'details' && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  Operations, Payment Methods & Profile
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Specify opening hours, accepted payment rails, and descriptive amenities.
                </p>
              </div>

              {/* Hours & Price Level */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    Opening Hours
                  </label>
                  <input
                    type="text"
                    value={openingHours}
                    onChange={(e) => setOpeningHours(e.target.value)}
                    placeholder="Mon - Sat: 8:00 AM - 6:00 PM"
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                    Price Level
                  </label>
                  <select
                    value={priceLevel}
                    onChange={(e) => setPriceLevel(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white font-medium"
                  >
                    <option value="₦">₦ - Budget / Mass Market</option>
                    <option value="₦₦">₦₦ - Moderate</option>
                    <option value="₦₦₦">₦₦₦ - Upscale / Premium</option>
                    <option value="₦₦₦₦">₦₦₦₦ - Luxury / High End</option>
                  </select>
                </div>
              </div>

              {/* Accepted Nigerian Payment Methods */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
                  Accepted Payment Methods (Click to toggle)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {NIGERIAN_PAYMENT_OPTIONS.map((method) => {
                    const isSelected = selectedPayments.includes(method);
                    return (
                      <button
                        type="button"
                        key={method}
                        onClick={() => togglePayment(method)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                        <span>{method}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tags / Amenities */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  Key Features / Amenities
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_TAG_SUGGESTIONS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        type="button"
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`text-[11px] px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 border-slate-800 dark:border-slate-200 font-semibold'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}{tag}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                    placeholder="Add custom tag (e.g. Halal Food, Wheelchair Accessible)"
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:border-emerald-500 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={addCustomTag}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>About / Overview of Products & Services</span>
                  <span className="text-[10px] text-slate-400 font-normal">{description.length} characters</span>
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detail what sets your business apart, product warranties, client satisfaction, and why customers across Nigeria should patronize you..."
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-emerald-500 text-slate-900 dark:text-white leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* Footer Navigation & Submit */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {activeTab !== 'basics' && (
                <button
                  type="button"
                  onClick={() => {
                    const tabs: Array<'basics' | 'location' | 'contact' | 'socials' | 'details'> = [
                      'basics',
                      'location',
                      'contact',
                      'socials',
                      'details',
                    ];
                    const currentIndex = tabs.indexOf(activeTab);
                    if (currentIndex > 0) setActiveTab(tabs[currentIndex - 1]);
                  }}
                  className="px-3.5 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                >
                  Back
                </button>
              )}

              {activeTab !== 'details' && (
                <button
                  type="button"
                  onClick={() => {
                    const tabs: Array<'basics' | 'location' | 'contact' | 'socials' | 'details'> = [
                      'basics',
                      'location',
                      'contact',
                      'socials',
                      'details',
                    ];
                    const currentIndex = tabs.indexOf(activeTab);
                    if (currentIndex < tabs.length - 1) setActiveTab(tabs[currentIndex + 1]);
                  }}
                  className="px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-xl transition cursor-pointer border border-emerald-200 dark:border-emerald-800"
                >
                  Next Step →
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-md hover:shadow-lg transition cursor-pointer"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>
                  {submitting
                    ? (isEditing ? 'Saving…' : 'Submitting…')
                    : (isEditing ? 'Save Changes' : 'Submit for Review')}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export const AddBusinessModal: React.FC<AddBusinessModalProps> = (props) =>
  props.isOpen ? <AddBusinessForm key={props.initialBusiness?.id || 'create'} {...props} /> : null;
