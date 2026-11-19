import React, { useState } from 'react';
import { useModal } from '../hooks/useModal';
import { 
  X, 
  Tag, 
  MapPin, 
  Phone, 
  MessageCircle, 
  Image as ImageIcon, 
  CheckCircle2, 
  Sparkles,
  Building2,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Upload,
  RefreshCw,
  Trash2,
  Plus
} from 'lucide-react';
import { 
  MarketplaceItem, 
  MarketplaceCategory, 
  MarketplaceCondition,
  Business 
} from '../types';
import { STATES_DATA } from '../data/nigeriaData';
import { MARKETPLACE_CATEGORIES } from '../data/marketplaceData';
import { AdInput, ValidationError } from '../services/content';
import { deleteMediaFile, extractMediaKeyFromUrl, replaceMediaFile, uploadMediaFile } from '../services/media';
import { LIMITS } from '../lib/config';
import { friendlyError } from '../lib/errors';

interface PostAdModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves once the ad is saved; throw to show an error inside the form. */
  onPostAd: (input: AdInput) => Promise<void>;
  /** Only the signed-in member's own business listings (an ad can only be linked to a business you own). */
  businesses: Business[];
}

const PHOTO_PRESETS: { label: string; url: string; category: MarketplaceCategory }[] = [
  {
    label: '📱 Smartphone',
    category: 'Phones & Tablets',
    url: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '💻 Laptop',
    category: 'Phones & Tablets',
    url: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '🚗 Car / Tokunbo',
    category: 'Vehicles',
    url: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '⚡ Solar Inverter',
    category: 'Electronics & Appliances',
    url: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '📺 Smart TV',
    category: 'Electronics & Appliances',
    url: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '👗 Agbada / Fashion',
    category: 'Fashion & Beauty',
    url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '🛋️ Sofa / Furniture',
    category: 'Home, Furniture & Living',
    url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '🏠 Shortlet Apartment',
    category: 'Real Estate',
    url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: '🌾 Agric Rice Bags',
    category: 'Agriculture & Food',
    url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&auto=format&fit=crop&q=80',
  },
];

const PostAdForm: React.FC<PostAdModalProps> = ({
  onClose,
  onPostAd,
  businesses,
}) => {
  useModal(onClose);
  const [submitting, setSubmitting] = useState(false);

  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [businessName, setBusinessName] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<MarketplaceCategory>('Phones & Tablets');
  const [price, setPrice] = useState<string>('');
  const [isNegotiable, setIsNegotiable] = useState<boolean>(true);
  const [condition, setCondition] = useState<MarketplaceCondition>('Brand New');
  const [selectedState, setSelectedState] = useState<string>('Lagos');
  const [selectedLga, setSelectedLga] = useState<string>('Ikeja');
  const [locationHub, setLocationHub] = useState<string>('Computer Village, Ikeja');
  const [imageUrl, setImageUrl] = useState<string>('https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&auto=format&fit=crop&q=80');
  const [additionalImages, setAdditionalImages] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [phone, setPhone] = useState<string>('');
  const [whatsapp, setWhatsapp] = useState<string>('');
  const [cacNumber, setCacNumber] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUploadMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setUploadingPhoto('main');
    try {
      const existingKey = extractMediaKeyFromUrl(imageUrl);
      const media = existingKey
        ? await replaceMediaFile(existingKey, file, 'marketplace_image')
        : await uploadMediaFile({ file, purpose: 'marketplace_image' });
      setImageUrl(media.url);
    } catch (err) {
      setErrorMsg(friendlyError(err, 'Could not upload product photo.'));
    } finally {
      setUploadingPhoto(null);
    }
  };

  const handleRemoveUploadedMainImage = async () => {
    const prev = imageUrl;
    setImageUrl('');
    if (extractMediaKeyFromUrl(prev)) {
      await deleteMediaFile(prev).catch(() => {});
    }
  };

  const handleUploadAdditionalImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const remaining = LIMITS.adImages - additionalImages.length;
    if (remaining <= 0) {
      setErrorMsg(`You can upload up to ${LIMITS.adImages} additional product photos.`);
      return;
    }
    setErrorMsg(null);
    setUploadingPhoto('gallery');
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, remaining)) {
        const media = await uploadMediaFile({ file, purpose: 'marketplace_image' });
        urls.push(media.url);
      }
      setAdditionalImages((prev) => [...prev, ...urls].slice(0, LIMITS.adImages));
    } catch (err) {
      setErrorMsg(friendlyError(err, 'Could not upload gallery photo.'));
    } finally {
      setUploadingPhoto(null);
    }
  };

  const handleRemoveAdditionalImage = async (idx: number) => {
    const target = additionalImages[idx];
    setAdditionalImages((prev) => prev.filter((_, i) => i !== idx));
    if (target && extractMediaKeyFromUrl(target)) {
      await deleteMediaFile(target).catch(() => {});
    }
  };

  // Available LGAs for chosen state
  const stateObj = STATES_DATA.find((s) => s.name.toLowerCase() === selectedState.toLowerCase());
  const lgas = stateObj ? stateObj.lgas : [];

  // When business is selected from dropdown, autofill contact & location
  const handleBusinessSelect = (bId: string) => {
    setSelectedBusinessId(bId);
    if (!bId) return;
    const b = businesses.find((biz) => biz.id === bId);
    if (b) {
      setBusinessName(b.name);
      setSelectedState(b.state);
      setSelectedLga(b.lga || '');
      setPhone(b.phone || '');
      setWhatsapp(b.whatsapp || b.phone || '');
      if (b.cacNumber) setCacNumber(b.cacNumber);
      if (b.address) setLocationHub(b.address);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    if (!title.trim()) {
      setErrorMsg('Please provide a descriptive title for your product or ad.');
      return;
    }
    if (!businessName.trim()) {
      setErrorMsg('Please specify the seller or business name.');
      return;
    }
    const numPrice = Number(price.replace(/[^0-9]/g, ''));
    if (!numPrice || numPrice <= 0) {
      setErrorMsg('Please enter a valid price in Nigerian Naira (₦).');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('A valid Nigerian contact phone number is required.');
      return;
    }

    // Note: "verified seller" and "featured" are NOT sent. Only admins can grant those.
    const input: AdInput = {
      businessId: selectedBusinessId || undefined,
      businessName: businessName.trim(),
      title: title.trim(),
      category,
      price: numPrice,
      isNegotiable,
      condition,
      description:
        description.trim() ||
        `${title.trim()} available for inspection and immediate sale in ${selectedState}. Contact seller on WhatsApp or phone for details.`,
      imageUrl: imageUrl.trim() || 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80',
      additionalImages,
      state: selectedState,
      lga: selectedLga || selectedState,
      locationHub: locationHub.trim() || undefined,
      phone: phone.trim(),
      whatsapp: whatsapp.trim() || phone.trim(),
      cacNumber: cacNumber.trim() || undefined,
    };

    setSubmitting(true);
    try {
      await onPostAd(input);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof ValidationError ? err.message : friendlyError(err, 'We could not post your ad. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden my-6 max-h-[92vh] flex flex-col"
        role="dialog" aria-modal="true" aria-label="Post an ad"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-700 text-white p-5 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🛍️</span>
              <h3 className="font-extrabold text-lg sm:text-xl">Post a Free Ad on Marketplace</h3>
            </div>
            <p className="text-emerald-100 text-xs mt-0.5">
              Verified Nigerian classifieds: reach thousands of buyers across Nigeria with direct WhatsApp and Call connectivity.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 text-xs sm:text-sm">
          {errorMsg && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-3 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Associate with Business (Optional) */}
          <div className="bg-emerald-50/60 dark:bg-emerald-950/30 p-3.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 space-y-2">
            <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <span>Link to one of your listed businesses (Optional)</span>
            </label>
            <select
              value={selectedBusinessId}
              onChange={(e) => handleBusinessSelect(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-200 outline-none"
            >
              <option value="">-- Post as Independent Seller or New Store --</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.state} - {b.category}){b.status === 'pending' ? ' · awaiting review' : ''}
                </option>
              ))}
            </select>
            {businesses.length === 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                You haven’t listed a business yet. Once you do, you can link ads to it here (a verified business gives your ads the Verified Seller badge).
              </p>
            )}
          </div>

          {/* Seller / Store Name */}
          <div>
            <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
              Store / Business Name *
            </label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Banex Royal Gadgets or Alaba Solar Hub"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none focus:border-emerald-500"
            />
          </div>

          {/* Item Title */}
          <div>
            <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
              Listing Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Apple iPhone 15 Pro Max 256GB - Clean Foreign Used"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none focus:border-emerald-500"
            />
          </div>

          {/* Category & Condition Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MarketplaceCategory)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              >
                {MARKETPLACE_CATEGORIES.filter(c => c.key !== 'All').map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                Condition *
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as MarketplaceCondition)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              >
                <option value="Brand New">Brand New</option>
                <option value="Foreign Used (Tokunbo)">Foreign Used (Tokunbo)</option>
                <option value="Nigerian Used">Nigerian Used</option>
                <option value="Refurbished">Refurbished</option>
              </select>
            </div>
          </div>

          {/* Price & Negotiable */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                Price (₦ Naira) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 font-bold text-slate-500">₦</span>
                <input
                  type="text"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="e.g. 450,000"
                  className="w-full pl-8 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none focus:border-emerald-500 font-bold"
                />
              </div>
            </div>

            <div className="sm:pt-6">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={isNegotiable}
                  onChange={(e) => setIsNegotiable(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Price is Negotiable (Bargain allowed)
                </span>
              </label>
            </div>
          </div>

          {/* State, LGA & Hub */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                State *
              </label>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  const st = STATES_DATA.find(s => s.name.toLowerCase() === e.target.value.toLowerCase());
                  if (st && st.lgas.length > 0) setSelectedLga(st.lgas[0]);
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              >
                {STATES_DATA.map((s) => (
                  <option key={s.key} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                LGA
              </label>
              <select
                value={selectedLga}
                onChange={(e) => setSelectedLga(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              >
                {lgas.map((lga) => (
                  <option key={lga} value={lga}>{lga}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                Market Hub / Plaza
              </label>
              <input
                type="text"
                value={locationHub}
                onChange={(e) => setLocationHub(e.target.value)}
                placeholder="e.g. Banex Plaza, Shop 14"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              />
            </div>
          </div>

          {/* R2 Upload, Photo Preset & Image URL */}
          <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                <span>Product Photos</span>
              </label>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer transition">
                  {uploadingPhoto === 'main' ? <Loader2 size={13} className="animate-spin" /> : extractMediaKeyFromUrl(imageUrl) ? <RefreshCw size={13} /> : <Upload size={13} />}
                  <span>
                    {uploadingPhoto === 'main'
                      ? 'Uploading…'
                      : extractMediaKeyFromUrl(imageUrl)
                        ? 'Replace Photo'
                        : 'Upload Photo (max 5 MB)'}
                  </span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadMainImage} />
                </label>
                {extractMediaKeyFromUrl(imageUrl) && (
                  <button
                    type="button"
                    onClick={handleRemoveUploadedMainImage}
                    aria-label="Delete uploaded photo"
                    className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {imageUrl && (
              <div className="flex items-center gap-3">
                <img
                  src={imageUrl}
                  alt="Selected product preview"
                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    Or paste an external https:// image URL
                  </label>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white outline-none font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {!imageUrl && (
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/... or upload a photo above"
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none font-mono text-xs"
              />
            )}

            {/* Additional Gallery Photos */}
            <div className="pt-1 border-t border-slate-200 dark:border-slate-700/70 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Extra Gallery Photos ({additionalImages.length}/{LIMITS.adImages})
                </span>
                {additionalImages.length < LIMITS.adImages && (
                  <label className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer inline-flex items-center gap-1">
                    {uploadingPhoto === 'gallery' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    <span>{uploadingPhoto === 'gallery' ? 'Uploading…' : 'Add More Photos'}</span>
                    <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={handleUploadAdditionalImages} />
                  </label>
                )}
              </div>
              {additionalImages.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {additionalImages.map((u, idx) => (
                    <div key={`${u}-${idx}`} className="relative group h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                      <img src={u} alt={`Extra ad ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveAdditionalImage(idx)}
                        aria-label={`Remove extra photo ${idx + 1}`}
                        className="absolute top-1 right-1 p-1 bg-rose-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] text-slate-500 font-medium">Quick Photo Presets:</span>
              {PHOTO_PRESETS.map((p, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => {
                    setImageUrl(p.url);
                    setCategory(p.category);
                  }}
                  className="text-[10px] bg-slate-200 dark:bg-slate-800 hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-300 px-2 py-0.5 rounded cursor-pointer transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contact: Phone & WhatsApp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 08031234567"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                WhatsApp Number
              </label>
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="e.g. 08031234567"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none"
              />
            </div>
          </div>

          {/* CAC Number (Optional) */}
          <div>
            <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
              CAC Registration Number (Optional)
            </label>
            <input
              type="text"
              value={cacNumber}
              onChange={(e) => setCacNumber(e.target.value)}
              placeholder="e.g. RC-192837 or BN-2849102"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none font-mono"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
              Item Details & Key Features
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe condition, battery life, mileage, warranty, reason for sale, packaging, etc."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white outline-none focus:border-emerald-500"
            />
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600" />
            <span>By posting you confirm the item is yours to sell. Prohibited, counterfeit or fraudulent ads are removed and repeat offenders are banned. The Verified Seller badge is awarded by our team, not self-declared.</span>
          </p>

          {/* Footer CTA */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingPhoto !== null}
              className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold shadow-md shadow-emerald-600/20 cursor-pointer transition-colors flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{submitting ? 'Posting…' : 'Post Ad Now'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const PostAdModal: React.FC<PostAdModalProps> = (props) =>
  props.isOpen ? <PostAdForm {...props} /> : null;
