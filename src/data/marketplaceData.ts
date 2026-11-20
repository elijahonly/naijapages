import { MarketplaceItem, MarketplaceCategory } from '../types';

export const MARKETPLACE_CATEGORIES: {
  key: MarketplaceCategory | 'All';
  label: string;
  emoji: string;
  description: string;
}[] = [
  { key: 'All', label: 'All Items', emoji: '🛍️', description: 'Browse all products & ads' },
  { key: 'Phones & Tablets', label: 'Phones & Tablets', emoji: '📱', description: 'iPhones, Samsung, Android, Accessories' },
  { key: 'Vehicles', label: 'Vehicles', emoji: '🚗', description: 'Cars, Tokunbo, SUVs, Auto Parts' },
  { key: 'Electronics & Appliances', label: 'Electronics', emoji: '⚡', description: 'Solar Inverters, TVs, Generators, Audio' },
  { key: 'Fashion & Beauty', label: 'Fashion & Beauty', emoji: '👗', description: 'Agbada, Lace, Shoes, Wigs, Watches' },
  { key: 'Home, Furniture & Living', label: 'Home & Furniture', emoji: '🛋️', description: 'Sofas, Beds, Kitchen, Decor' },
  { key: 'Real Estate', label: 'Real Estate', emoji: '🏠', description: 'Shortlets, Apartments, Land, Shops' },
  { key: 'Agriculture & Food', label: 'Agric & Food', emoji: '🌾', description: 'Rice Bags, Farm Produce, Livestock' },
  { key: 'Commercial & Industrial', label: 'Commercial & Tools', emoji: '🏭', description: 'Heavy Machinery, Printing, Hardware' },
  { key: 'Services', label: 'Services & Artisans', emoji: '🛠️', description: 'Electricians, Mechanics, Tailoring, Logistics' },
];

/**
 * Marketplace ads are loaded exclusively from Cloudflare D1 (`/api/v1/marketplace/ads` & `/api/v1/directory/bootstrap`).
 * No demonstration or placeholder advertisements are bundled in the frontend.
 */
export const INITIAL_MARKETPLACE_ITEMS: MarketplaceItem[] = [];

export const MARKETPLACE_SAFETY_TIPS = [
  {
    title: 'Meet in a Safe Public Venue',
    desc: 'Never meet in secluded or private residences. Choose busy plazas, malls, or banks with security guards.',
  },
  {
    title: 'Inspect Before You Pay',
    desc: 'Check the item thoroughly (test electronics, verify car papers, check phone IMEI) before releasing funds.',
  },
  {
    title: 'Beware of Unrealistic Cheap Prices',
    desc: 'If a brand new iPhone 15 or Toyota Camry is priced at ₦80,000, it is almost certainly fraudulent.',
  },
  {
    title: 'Do Not Pay Advance Delivery Fees',
    desc: 'Do not transfer money for "commitment" or "delivery fee" before seeing the product in person.',
  },
];
