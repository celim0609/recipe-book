/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface BrandLogoProps {
  className?: string;
}

export default function BrandLogo({ className = 'h-8 w-auto' }: BrandLogoProps) {
  return (
    <span className={`brand-logo inline-flex items-center justify-center ${className}`} aria-label="MiseChef logo">
      <img
        src="/assets/logo/logo-black.svg"
        alt=""
        className="brand-logo-light h-full w-auto object-contain"
        aria-hidden="true"
      />
      <img
        src="/assets/logo/logo-white.svg"
        alt=""
        className="brand-logo-dark h-full w-auto object-contain"
        aria-hidden="true"
      />
    </span>
  );
}
