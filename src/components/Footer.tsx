import React from 'react';
import { Mail, Phone, MapPin } from 'lucide-react';
import { SITE_NAME } from '../lib/config';
import { SiteSettings } from '../types';
import { safeHttpUrl } from '../lib/security';

interface FooterProps {
  settings: SiteSettings;
  onOpenStateExplorer: () => void;
  onOpenEmergency: () => void;
  onAddBusiness: () => void;
  onPostAd: () => void;
}

const linkCls = 'hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer text-left';

export const Footer: React.FC<FooterProps> = ({ settings, onOpenStateExplorer, onOpenEmergency, onAddBusiness, onPostAd }) => {
  const whatsappDigits = settings.whatsapp.replace(/[^0-9]/g, '');
  const whatsappUrl = whatsappDigits ? safeHttpUrl(`https://wa.me/${whatsappDigits}`) : undefined;

  return (
    <footer className="mt-16 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pt-12 pb-8 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-black">🇳🇬</div>
            <p className="font-extrabold text-base text-slate-900 dark:text-white tracking-tight">
              Naija<span className="text-emerald-600 dark:text-emerald-400">Pages</span>
            </p>
          </div>
          <p className="mt-3 max-w-sm leading-relaxed text-[12px]">
            Nigeria’s business directory and marketplace, connecting people with businesses and storefronts across all 36 States and the Federal Capital Territory.
          </p>

          {(settings.contactEmail || settings.contactPhone || whatsappUrl) && (
            <ul className="mt-4 space-y-1.5 text-[12px]">
              {settings.contactEmail && (
                <li className="flex items-center gap-2">
                  <Mail size={13} className="text-emerald-600 shrink-0" />
                  <a className={linkCls} href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
                </li>
              )}
              {settings.contactPhone && (
                <li className="flex items-center gap-2">
                  <Phone size={13} className="text-emerald-600 shrink-0" />
                  <a className={linkCls} href={`tel:${settings.contactPhone.replace(/\s+/g, '')}`}>{settings.contactPhone}</a>
                </li>
              )}
              {settings.address && (
                <li className="flex items-start gap-2">
                  <MapPin size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                  <span>{settings.address}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        <nav aria-label="Explore">
          <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] mb-3">Explore</h3>
          <ul className="space-y-2 font-medium text-slate-600 dark:text-slate-300">
            <li><a className={linkCls} href="#/">Business Directory</a></li>
            <li><a className={`${linkCls} font-bold text-amber-600 dark:text-amber-400`} href="#/marketplace">🛍️ Marketplace</a></li>
            <li><button type="button" className={linkCls} onClick={onOpenStateExplorer}>Browse 36 States</button></li>
            <li><button type="button" className={`${linkCls} hover:!text-red-500`} onClick={onOpenEmergency}>Emergency 112 / 767</button></li>
          </ul>
        </nav>

        <nav aria-label="Company">
          <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px] mb-3">Company</h3>
          <ul className="space-y-2 font-medium text-slate-600 dark:text-slate-300">
            <li><a className={linkCls} href="#/about">About Us</a></li>
            <li><a className={linkCls} href="#/contact">Contact Us</a></li>
            <li><button type="button" className={linkCls} onClick={onAddBusiness}>List Your Business</button></li>
            <li><button type="button" className={linkCls} onClick={onPostAd}>Post a Free Ad</button></li>
          </ul>
        </nav>
      </div>

      <div className="max-w-7xl mx-auto pt-6 mt-8 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400">
        <p>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</p>
        <p>
          Listings are provided by businesses and members.{' '}
          <a href="#/contact" className="underline underline-offset-2 hover:text-emerald-600">Spotted a problem? Tell us.</a>
        </p>
      </div>
    </footer>
  );
};
