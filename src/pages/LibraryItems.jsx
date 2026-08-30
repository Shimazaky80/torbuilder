import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCurrencies } from '../hooks/useCurrencies';
import { useToast } from '../context/ToastContext';
import { 
  Package, 
  Building2, 
  Search, 
  Plus, 
  Minus,
  Users,
  User,
  Edit3, 
  Trash2, 
  X, 
  Check, 
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hotel, 
  Bus, 
  Utensils, 
  Compass, 
  Ticket, 
  UserCheck, 
  Sparkles,
  Plane,
  Car,
  Calendar,
  DollarSign,
  Image as ImageIcon,
  UploadCloud,
  FileText,
  Filter,
  MapPin,
  Globe,
  Tag,
  Download,
  Loader2,
  Navigation,
  Leaf
} from 'lucide-react';





export const LibraryItems = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [libraryItemsList, setLibraryItemsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showInlineForm, setShowInlineForm] = useState(true);

  // Editing state: when set, the inline form updates these items instead of inserting.
  // Maps form tempId -> existing library_items row id.
  const [editingItems, setEditingItems] = useState({});

  // Image gallery lightbox & description popup
  const [lightbox, setLightbox] = useState(null); // { images: [], index: number }
  const [descriptionPopup, setDescriptionPopup] = useState(null);
  const [contractPopup, setContractPopup] = useState(null); // { name, url }
  const [uploadingContract, setUploadingContract] = useState(null); // tempId being uploaded

  // Supplier creation mode: 'existing' vs 'new'
  const [supplierMode, setSupplierMode] = useState('existing');

  // Multi-item support toggle
  const [addMultiple, setAddMultiple] = useState(true);

  // Comprehensive Supplier Form State (Matching Screenshot)
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    country: 'South Africa',
    provinceState: '',
    city: '',
    bankName: '',
    accountHolderName: '',
    bankAccountNumber: '',
    branchCode: '',
    swiftCode: ''
  });

  const [savingSupplier, setSavingSupplier] = useState(false);
  const [saving, setSaving] = useState(false);

  // DB feature detection (columns may be missing until migrations are applied)
  const [dbFeatures, setDbFeatures] = useState({ guideDriver: true, contracts: true, tieredPricing: true, transferType: true, feeType: true });
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Form State: Array of items for batch creation under supplier
  const [itemsToSave, setItemsToSave] = useState([createNewItemTemplate(1)]);

  const { showToast } = useToast();
  const location = useLocation();
  const { currencies } = useCurrencies();

  const categoryOptions = [
    { id: 'Accommodation', label: 'Accommodation', icon: Hotel, color: '#863bff' },
    { id: 'Transfers', label: 'Transfers', icon: Bus, color: '#3b82f6' },
    { id: 'Activities / Tours', label: 'Activities / Tours', icon: Compass, color: '#10b981' },
    { id: 'Flights / Charter', label: 'Flights / Charter', icon: Plane, color: '#6366f1' },
    { id: 'Meals', label: 'Meals', icon: Utensils, color: '#f59e0b' },
    { id: 'Guide / Driver', label: 'Guide / Driver', icon: UserCheck, color: '#8b5cf6' },
    { id: 'Extras', label: 'Extras', icon: Sparkles, color: '#ec4899' },
    { id: 'Car Rental', label: 'Car Rental', icon: Car, color: '#06b6d4' }
  ];

  // Category options are driven by the library_categories table when present,
  // falling back to the built-in list above (e.g. before the migration is run).
  const [categories, setCategories] = useState(categoryOptions);

  const mealPlanOptions = [
    'Room Only',
    'Self Catering',
    'Bed & Breakfast',
    'Half Board',
    'Full Board',
    'All Inclusive'
  ];

  const vehicleOptions = [
    { label: 'Sedans (up to 3 pax)', pax: 3 },
    { label: 'Minivan (up to 8 pax)', pax: 8 },
    { label: 'Microbus (up to 14 pax)', pax: 14 },
    { label: 'Minibus (up to 26 pax)', pax: 26 },
    { label: 'Coach (up to 52 pax)', pax: 52 }
  ];

  const transferPricingOptions = [
    { id: 'per_vehicle', label: 'Flat Rate (Per Vehicle)' },
    { id: 'per_person', label: 'Per Person' },
    { id: 'tiered', label: 'Tiered (by pax count)' }
  ];

  const transferTypes = [
    {
      id: 'airport_city',
      label: 'Airport / City',
      icon: '✈️',
      description: 'From/to the airport or city transfers to hotels — minutes to a few hours, same day.'
    },
    {
      id: 'dinner',
      label: 'Dinner',
      icon: '🍽️',
      description: 'Evening transfers to/from restaurants for dinner.'
    },
    {
      id: 'overland',
      label: 'Overland',
      icon: '🛤️',
      description: 'Long-haul transfer that spends the night away from the origin city.'
    }
  ];

  // Categories that use the simplified tour/transfer form: vehicle capacity,
  // per-vehicle / per-person / tiered pricing, and a minimal seasonal matrix.
  const isTourStyleCategory = (category) => category === 'Transfers' || category === 'Activities / Tours';

  // Surcharge fees added on top of base rates.
  // - Entrance fees: per person and/or per vehicle (Accommodation + Transfers).
  // - Conservation levy: per adult and per child, charged per night or per stay
  //   (Accommodation).
  const feeTypeOptions = {
    accommodation: [
      { id: 'none', label: 'None' },
      { id: 'entrance', label: '🎟️ Entrance Fees' },
      { id: 'conservation', label: '🌿 Conservation Levy' }
    ],
    transfers: [
      { id: 'none', label: 'None' },
      { id: 'entrance', label: '🎟️ Entrance Fees' }
    ]
  };
  const levyBasisOptions = [
    { id: 'per_night', label: 'Per Night' },
    { id: 'per_stay', label: 'Per Stay' }
  ];

  // Dynamic Country Options derived from full currencies table
  const countryOptions = currencies.length > 0
    ? [...new Set(currencies.map(c => c.country).filter(Boolean))].sort()
    : [
        'South Africa',
        'Tanzania',
        'Kenya',
        'Namibia',
        'Botswana',
        'Uganda',
        'Rwanda',
        'Zambia',
        'Zimbabwe',
        'United States',
        'United Kingdom',
        'Germany',
        'France',
        'Australia',
        'Other'
      ];

  function ensureSharingRules(maxAdults = 2, maxOccupancy = 2, currentRules = []) {
    const safeAdults = Math.max(1, parseInt(maxAdults) || 2);
    const safeMaxOcc = Math.max(safeAdults, parseInt(maxOccupancy) || 2);
    const rulesMap = {};
    if (Array.isArray(currentRules)) {
      currentRules.forEach(r => {
        if (r && r.adults) {
          rulesMap[r.adults] = r.maxChildren;
        }
      });
    }

    const result = [];
    for (let a = 1; a <= safeAdults; a++) {
      const rowMaxAllowed = Math.max(0, safeMaxOcc - a);
      let assigned = rulesMap[a] !== undefined ? parseInt(rulesMap[a]) : rowMaxAllowed;
      if (isNaN(assigned)) assigned = rowMaxAllowed;
      assigned = Math.max(0, Math.min(rowMaxAllowed, assigned));
      result.push({
        adults: a,
        maxChildren: assigned
      });
    }
    return result;
  }

  function createNewItemTemplate(index = 1) {
    const defaultAgeBands = [
      { id: 'band_1', name: 'Infants', ageFrom: 0, ageTo: 2 },
      { id: 'band_2', name: 'Children', ageFrom: 3, ageTo: 11 },
      { id: 'band_3', name: 'Teens', ageFrom: 12, ageTo: 17 }
    ];

    const initialMaxOcc = 2;
    const initialMaxAdults = 2;

    return {
      tempId: Date.now() + Math.random(),
      itemIndex: index,
      name: '',
      category: 'Accommodation',
      currency: 'ZAR',
      mealPlan: 'Bed & Breakfast',
      vehicleType: '',
      transferType: '',
      feeType: 'none', // 'none' | 'entrance' | 'conservation'
      levyBasis: 'per_night', // 'per_night' | 'per_stay' (conservation only)
      childAge: 12,
      pricingModel: 'per_person', // 'per_person' | 'per_room' | transfer: 'per_vehicle' | 'tiered'
      maxOccupancy: initialMaxOcc,
      maxAdults: initialMaxAdults,
      maxChildren: 1,
      sharingCapacityRules: ensureSharingRules(initialMaxAdults, initialMaxOcc, [
        { adults: 1, maxChildren: 1 },
        { adults: 2, maxChildren: 0 }
      ]),
      guideDriverOffered: false,
      description: '',
      imageUrls: [],
      newImageUrlInput: '',
      contractUrl: '',
      contractName: '',
      childAgeRanges: defaultAgeBands,
      seasons: [
        {
          seasonName: 'Base Season',
          validFrom: '',
          validTo: '',
          roomRate: 0, // Flat Room / Unit Rate (Divided by number of occupants)
          price1Adult: 0, // Single Room (1 Adult - Per Person)
          price2Adults: 0, // Per Person Sharing (PPS - 2+ Adults Sharing)
          price3PlusAdults: 0, // Extra Adult (3+ Adults Sharing)
          childRates: { band_1: 0, band_2: 0, band_3: 0 },
          childDiscount: 0,
          guideRate: 0, // Guide Room Rate per night (0 = fallback to Single rate)
          driverRate: 0, // Driver Room Rate per night (0 = fallback to Single rate)
          guideMealPlan: 'Bed & Breakfast',
          driverMealPlan: 'Bed & Breakfast',
          adultRate: 0,
          childRate: 0,
          tiers: [],
          vehicleRate: 0,
          entranceFeePerson: 0,
          entranceFeeVehicle: 0,
          levyAdultRate: 0,
          levyChildRate: 0
        }
      ]
    };
  }

  const handleSharingRuleChange = (tempId, adultCount, maxChildrenVal) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const safeMaxOcc = parseInt(item.maxOccupancy) || 2;
        const currentRules = item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, safeMaxOcc, []);
        const rowMaxAllowed = Math.max(0, safeMaxOcc - adultCount);
        const parsedVal = maxChildrenVal === '' ? '' : Math.max(0, Math.min(rowMaxAllowed, parseInt(maxChildrenVal) || 0));

        const updated = currentRules.map(r => {
          if (r.adults === adultCount) {
            return { ...r, maxChildren: parsedVal };
          }
          return r;
        });

        return {
          ...item,
          sharingCapacityRules: updated
        };
      }
      return item;
    }));
  };

  const handleAddChildAgeBand = (tempId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const currentBands = item.childAgeRanges || [];
        const newBandId = 'band_' + Date.now();
        const lastBand = currentBands[currentBands.length - 1];
        const nextAgeFrom = lastBand ? (lastBand.ageTo + 1) : 0;
        const newBand = {
          id: newBandId,
          name: 'Tier ' + (currentBands.length + 1),
          ageFrom: nextAgeFrom,
          ageTo: nextAgeFrom + 5
        };
        return {
          ...item,
          childAgeRanges: [...currentBands, newBand]
        };
      }
      return item;
    }));
  };

  const handleUpdateChildAgeBand = (tempId, bandIdx, field, val) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updated = (item.childAgeRanges || []).map((b, idx) => {
          if (idx === bandIdx) {
            const parsedVal = (field === 'ageFrom' || field === 'ageTo') 
              ? Math.max(0, parseInt(val) || 0) 
              : val;
            return { ...b, [field]: parsedVal };
          }
          return b;
        });
        return { ...item, childAgeRanges: updated };
      }
      return item;
    }));
  };

  const handleRemoveChildAgeBand = (tempId, bandIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId && (item.childAgeRanges || []).length > 1) {
        return {
          ...item,
          childAgeRanges: item.childAgeRanges.filter((_, idx) => idx !== bandIdx)
        };
      }
      return item;
    }));
  };

  const handleChildRateChange = (tempId, seasonIdx, bandId, rate) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedSeasons = item.seasons.map((s, idx) => {
          if (idx === seasonIdx) {
            const updatedChildRates = {
              ...(s.childRates || {}),
              [bandId]: rate
            };
            return { ...s, childRates: updatedChildRates };
          }
          return s;
        });
        return { ...item, seasons: updatedSeasons };
      }
      return item;
    }));
  };

  // ── Resolve company_id robustly ──────────────────────────────────────────
  // 1. Try profiles.company_id  (normal path)
  // 2. Fall back to companies.owner_id = auth user  (after schema reset)
  const resolveCompanyId = async (user) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (profile?.company_id) return profile.company_id;

    // Fallback: find a company owned by this user
    const { data: ownedCompany } = await supabase
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .single();

    if (ownedCompany?.id) return ownedCompany.id;

    throw new Error(
      'Company not found. Your account is not linked to a company. Please contact support or re-register.'
    );
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchLibraryItems();
  }, [categoryFilter, selectedSupplierId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') setLightbox(prev => prev && { ...prev, index: (prev.index + 1) % prev.images.length });
      if (e.key === 'ArrowLeft') setLightbox(prev => prev && { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // Detect which DB columns exist (lean toward enabled when the DB is
      // stricter); column names come from PostgREST's OpenAPI introspection.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const specResp = await fetch(`${url}/rest/v1/`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` }
          });
          if (specResp.ok) {
            const spec = await specResp.json();
            const libCols = spec.definitions?.library_items?.properties ? Object.keys(spec.definitions.library_items.properties) : [];
            const rateCols = spec.definitions?.item_rates?.properties ? Object.keys(spec.definitions.item_rates.properties) : [];
            setDbFeatures({
              guideDriver: libCols.includes('guide_driver_room_offered') && rateCols.includes('guide_rate') && rateCols.includes('driver_rate') && rateCols.includes('guide_meal_plan') && rateCols.includes('driver_meal_plan'),
              contracts: libCols.includes('contract_url') && libCols.includes('contract_name'),
              tieredPricing: rateCols.includes('tiered_pricing'),
              transferType: libCols.includes('transfer_type'),
              feeType: libCols.includes('fee_type') && rateCols.includes('entrance_fee_per_person') && rateCols.includes('conservation_levy_per_adult')
            });
          }
        }
      } catch {
        // Introspection failed — assume feature is present.
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let companyId;
      try {
        companyId = await resolveCompanyId(user);
      } catch {
        // No company linked yet — show empty state without crashing
        setLoading(false);
        return;
      }

      const { data: sups } = await supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', companyId)
        .order('name', { ascending: true });

      setSuppliers(sups || []);

      // Load category options from the database (falls back to the built-in
      // list on error, e.g. when library_categories doesn't exist yet).
      try {
        const { data: catsData } = await supabase
          .from('library_categories')
          .select('id, name, icon, color, sort_order')
          .order('sort_order', { ascending: true });
        if (catsData && catsData.length > 0) {
          const legacyNames = ['Entrance fees', 'Conservation Levies'];
          setCategories(catsData
            .filter(c => !legacyNames.includes(c.name))
            .map(c => {
              const match = categoryOptions.find(o => o.id === c.name);
              return { id: c.name, label: c.name, icon: match?.icon || Package, color: c.color || match?.color || '#334155' };
            }));
        }
      } catch {
        // table missing — keep fallback
      }

      const preselectedId = location.state?.supplierId;
      if (preselectedId && sups?.some(s => s.id === preselectedId)) {
        setSelectedSupplierId(preselectedId);
        setShowInlineForm(true);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchLibraryItems = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) return;

      // ── Fetch all three tables as plain queries (no PostgREST FK joins)
      // This avoids "schema cache" errors regardless of FK registration state

      let itemQuery = supabase
        .from('library_items')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false });

      if (selectedSupplierId) {
        itemQuery = itemQuery.eq('supplier_id', selectedSupplierId);
      }
      if (categoryFilter !== 'All') {
        itemQuery = itemQuery.eq('category', categoryFilter);
      }

      const { data: items, error: itemsError } = await itemQuery;
      if (itemsError) throw itemsError;

      const itemIds = (items || []).map(i => i.id);

      // Fetch item_rates separately — no FK join
      const { data: ratesData } = itemIds.length > 0
        ? await supabase.from('item_rates').select('*').in('item_id', itemIds)
        : { data: [] };

      // Fetch suppliers separately — no FK join
      const { data: suppliersData } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('company_id', profile.company_id);

      // Build lookup maps and merge
      const ratesMap = {};
      (ratesData || []).forEach(r => {
        if (!ratesMap[r.item_id]) ratesMap[r.item_id] = [];
        ratesMap[r.item_id].push(r);
      });

      const supplierMap = {};
      (suppliersData || []).forEach(s => { supplierMap[s.id] = s; });

      const merged = (items || []).map(item => ({
        ...item,
        item_rates: ratesMap[item.id] || [],
        supplier: supplierMap[item.supplier_id] || null
      }));

      setLibraryItemsList(merged);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Add Another Library Item Card in Batch Form
  const handleAddAnotherItem = () => {
    setItemsToSave(prev => [
      ...prev,
      createNewItemTemplate(prev.length + 1)
    ]);
  };

  // Remove Item Card from Batch Form
  const handleRemoveItemCard = (tempId) => {
    if (itemsToSave.length === 1) return;
    setItemsToSave(prev => prev.filter(item => item.tempId !== tempId));
  };

  // Update Item Field
  const handleItemFieldChange = (tempId, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  // Save Supplier Only handler (Inside new supplier box)
  const handleSaveSupplierOnly = async () => {
    if (!supplierForm.name.trim()) {
      showToast('Supplier Name is required', 'warning');
      return;
    }

    setSavingSupplier(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const companyId = await resolveCompanyId(user);

      const newSupPayload = {
        company_id: companyId,
        name: supplierForm.name.trim(),
        category: itemsToSave[0]?.category || 'Accommodation',
        contact_person: supplierForm.contactPerson,
        email: supplierForm.email,
        phone: supplierForm.phone,
        website: supplierForm.website,
        address: supplierForm.address,
        physical_address: supplierForm.address,
        country: supplierForm.country,
        province_state: supplierForm.provinceState,
        city: supplierForm.city,
        city_location: supplierForm.city || supplierForm.provinceState,
        bank_name: supplierForm.bankName,
        account_holder_name: supplierForm.accountHolderName,
        bank_account_number: supplierForm.bankAccountNumber,
        branch_code: supplierForm.branchCode,
        swift_code: supplierForm.swiftCode
      };

      const { data: createdSup, error: supErr } = await supabase
        .from('suppliers')
        .insert([newSupPayload])
        .select()
        .single();

      if (supErr) throw supErr;

      setSuppliers(prev => [...prev, createdSup]);
      setSelectedSupplierId(createdSup.id);
      setSupplierMode('existing');
      setSupplierForm({
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
        website: '',
        address: '',
        country: 'South Africa',
        provinceState: '',
        city: '',
        bankName: '',
        accountHolderName: '',
        bankAccountNumber: '',
        branchCode: '',
        swiftCode: ''
      });
      showToast(`Supplier "${createdSup.name}" created and saved! Library Items section is now active.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleCancelSupplierForm = () => {
    setSupplierMode('existing');
    setSupplierForm({
      name: '',
      contactPerson: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      country: 'South Africa',
      provinceState: '',
      city: '',
      bankName: '',
      accountHolderName: '',
      bankAccountNumber: '',
      branchCode: '',
      swiftCode: ''
    });
  };

  // Upload JPEG Images (Max 10 per Library Item)
  const handleImageFilesUpload = (tempId, files) => {
    if (!files || files.length === 0) return;

    const targetItem = itemsToSave.find(item => item.tempId === tempId);
    if (!targetItem) return;

    const currentCount = targetItem.imageUrls?.length || 0;
    if (currentCount >= 10) {
      showToast('Maximum 10 images reached for this library item', 'warning');
      return;
    }

    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg' || file.name.match(/\.(jpe?g)$/i);
      if (!isJpeg) {
        showToast(`"${file.name}" skipped: Only JPEG (.jpg / .jpeg) image files are allowed.`, 'warning');
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    const remainingSlots = 10 - currentCount;
    const filesToProcess = validFiles.slice(0, remainingSlots);
    if (validFiles.length > remainingSlots) {
      showToast(`Only ${remainingSlots} more image(s) could be added (max 10 total).`, 'info');
    }

    filesToProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        setItemsToSave(prev => prev.map(item => {
          if (item.tempId === tempId) {
            if (item.imageUrls.length >= 10) return item;
            return {
              ...item,
              imageUrls: [...item.imageUrls, dataUrl]
            };
          }
          return item;
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (tempId, imgIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedImages = item.imageUrls.filter((_, idx) => idx !== imgIdx);
        return { ...item, imageUrls: updatedImages };
      }
      return item;
    }));
  };

  // Reorder image within an item's gallery. direction: -1 = move left, +1 = move right.
  const handleMoveImage = (tempId, fromIdx, direction) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const toIdx = fromIdx + direction;
      if (toIdx < 0 || toIdx >= item.imageUrls.length) return item;
      const urls = [...item.imageUrls];
      [urls[fromIdx], urls[toIdx]] = [urls[toIdx], urls[fromIdx]];
      return { ...item, imageUrls: urls };
    }));
  };

  // Build a browser-renderable source for a contract file (PDF native, Office via viewer)
  const getContractViewerSrc = (url, name) => {
    const fileName = (name || url || '').split('/').pop() || '';
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.pdf')) return url;
    if (/\.(docx?|xlsx?|pptx?)$/.test(lower)) {
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // Upload a contract document (PDF / Word / Excel) to Supabase Storage
  const handleContractFileSelect = async (tempId, files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const lowerName = (file.name || '').toLowerCase();
    if (!/\.(pdf|docx?|xlsx?)$/.test(lowerName)) {
      showToast(`"${file.name}" skipped: Only PDF, Word and Excel files are allowed.`, 'warning');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast('Contract file exceeds the 30 MB limit.', 'warning');
      return;
    }

    const target = itemsToSave.find(i => i.tempId === tempId);
    if (!target) return;
    if (target.contractUrl) {
      showToast('A contract is already attached. Remove it first to upload a new one.', 'warning');
      return;
    }

    setUploadingContract(tempId);

    let folder = 'contracts';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const cid = await resolveCompanyId(user);
        if (cid) folder = `contracts/${cid}`;
      }
    } catch {
      // Fall back to the shared contracts folder.
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${Date.now()}_${safeName}`;

    const { error: upErr } = await supabase.storage.from('contracts').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) {
      showToast(`Contract upload failed: ${upErr.message}`, 'error');
      setUploadingContract(null);
      return;
    }

    const { data: pubData } = supabase.storage.from('contracts').getPublicUrl(path);

    setItemsToSave(prev => prev.map(i => {
      if (i.tempId !== tempId) return i;
      return { ...i, contractUrl: pubData?.publicUrl || '', contractName: file.name };
    }));
    setUploadingContract(null);
    showToast('Contract uploaded.', 'success');
  };

  const handleRemoveContract = (tempId) => {
    setItemsToSave(prev => prev.map(i => {
      if (i.tempId !== tempId) return i;
      return { ...i, contractUrl: '', contractName: '' };
    }));
  };

  // Seasons Management within an item
  const handleAddSeasonRow = (tempId) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const seasonCount = item.seasons.length + 1;
        const childRatesInit = {};
        (item.childAgeRanges || []).forEach(b => {
          childRatesInit[b.id] = 0;
        });
        return {
          ...item,
          seasons: [
            ...item.seasons,
            {
              seasonName: `Season ${seasonCount}`,
              validFrom: '',
              validTo: '',
              roomRate: 0,
              price1Adult: 0,
              price2Adults: 0,
              price3PlusAdults: 0,
              childRates: childRatesInit,
              singleSupplement: 0,
              childDiscount: 0,
              guideRate: 0,
              driverRate: 0,
              guideMealPlan: 'Bed & Breakfast',
              driverMealPlan: 'Bed & Breakfast',
              adultRate: 0,
              childRate: 0,
              tiers: [],
              vehicleRate: 0,
              entranceFeePerson: 0,
              entranceFeeVehicle: 0,
              levyAdultRate: 0,
              levyChildRate: 0
            }
          ]
        };
      }
      return item;
    }));
  };

  // Transfer: pick a vehicle type (auto-fills max occupancy from its pax capacity)
  const handleVehicleTypeChange = (tempId, label) => {
    const opt = vehicleOptions.find(o => o.label === label);
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      return {
        ...item,
        vehicleType: label,
        maxOccupancy: opt ? opt.pax : (parseInt(item.maxOccupancy) || 0)
      };
    }));
  };

  // Switch category AND keep a valid pricing model for it
  const handleCategoryChange = (tempId, category) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      let pricingModel = item.pricingModel;
      if (isTourStyleCategory(category)) {
        if (!['per_vehicle', 'per_person', 'tiered'].includes(pricingModel)) pricingModel = 'per_vehicle';
      } else if (category === 'Accommodation') {
        pricingModel = 'per_person';
      } else {
        if (['per_vehicle', 'tiered'].includes(pricingModel)) pricingModel = 'per_person';
      }
      const feeType = (category === 'Accommodation' || category === 'Transfers') ? (item.feeType || 'none') : 'none';
      return { ...item, category, pricingModel, feeType };
    }));
  };

  // Transfer tiered pricing rows
  const handleAddTierRow = (tempId, seasonIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        return { ...s, tiers: [...(s.tiers || []), { minPax: '', maxPax: '', rate: '' }] };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleUpdateTier = (tempId, seasonIdx, tierIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        const updatedTiers = (s.tiers || []).map((t, tIdx) => tIdx === tierIdx ? { ...t, [field]: value } : t);
        return { ...s, tiers: updatedTiers };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleRemoveTier = (tempId, seasonIdx, tierIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId !== tempId) return item;
      const updatedSeasons = item.seasons.map((s, idx) => {
        if (idx !== seasonIdx) return s;
        return { ...s, tiers: (s.tiers || []).filter((_, tIdx) => tIdx !== tierIdx) };
      });
      return { ...item, seasons: updatedSeasons };
    }));
  };

  const handleSeasonChange = (tempId, seasonIdx, field, value) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId) {
        const updatedSeasons = item.seasons.map((s, idx) => {
          if (idx === seasonIdx) {
            return { ...s, [field]: value };
          }
          return s;
        });
        return { ...item, seasons: updatedSeasons };
      }
      return item;
    }));
  };

  const handleRemoveSeasonRow = (tempId, seasonIdx) => {
    setItemsToSave(prev => prev.map(item => {
      if (item.tempId === tempId && item.seasons.length > 1) {
        return {
          ...item,
          seasons: item.seasons.filter((_, idx) => idx !== seasonIdx)
        };
      }
      return item;
    }));
  };

  // Submit All Batch Items (along with new Supplier if supplierMode === 'new' or if supplier not yet saved)
  const handleSubmitAllItems = async (e) => {
    e.preventDefault();

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const companyId = await resolveCompanyId(user);

      let targetSupplierId = selectedSupplierId;

      // If creating a NEW supplier inline (or supplier hasn't been saved yet)
      if (supplierMode === 'new' || (!targetSupplierId && supplierForm.name.trim())) {
        if (!supplierForm.name.trim()) {
          showToast('Supplier Name is required to save library items', 'warning');
          return;
        }

        const newSupPayload = {
          company_id: companyId,
          name: supplierForm.name.trim(),
          category: itemsToSave[0]?.category || 'Accommodation',
          contact_person: supplierForm.contactPerson,
          email: supplierForm.email,
          phone: supplierForm.phone,
          website: supplierForm.website,
          address: supplierForm.address,
          physical_address: supplierForm.address,
          country: supplierForm.country,
          province_state: supplierForm.provinceState,
          city: supplierForm.city,
          city_location: supplierForm.city || supplierForm.provinceState,
          bank_name: supplierForm.bankName,
          account_holder_name: supplierForm.accountHolderName,
          bank_account_number: supplierForm.bankAccountNumber,
          branch_code: supplierForm.branchCode,
          swift_code: supplierForm.swiftCode
        };

        const { data: createdSup, error: supErr } = await supabase
          .from('suppliers')
          .insert([newSupPayload])
          .select()
          .single();

        if (supErr) throw supErr;

        targetSupplierId = createdSup.id;
        setSuppliers(prev => [...prev, createdSup]);
        setSelectedSupplierId(createdSup.id);
        setSupplierMode('existing');
        showToast(`Supplier "${createdSup.name}" created and saved to Suppliers Directory!`, 'success');
      }

      if (!targetSupplierId) {
        showToast('Please select or create a supplier first', 'warning');
        return;
      }

      // Check if item names are populated
      for (let i = 0; i < itemsToSave.length; i++) {
        if (!itemsToSave[i].name.trim()) {
          showToast(`Library Item ${i + 1} requires a name`, 'warning');
          return;
        }
        if (itemsToSave[i].category === 'Transfers' && dbFeatures.transferType && !itemsToSave[i].transferType) {
          showToast(`Transfer Item ${i + 1} requires a Transfer Type`, 'warning');
          return;
        }
        if (isTourStyleCategory(itemsToSave[i].category) && !itemsToSave[i].vehicleType) {
          showToast(`${itemsToSave[i].category} Item ${i + 1} requires a Vehicle Type`, 'warning');
          return;
        }
      }

      // Save all Library Items
      for (const itemData of itemsToSave) {
        const maxOcc = Math.max(1, parseInt(itemData.maxOccupancy) || 2);
        const maxAdults = Math.max(1, parseInt(itemData.maxAdults) || maxOcc);
        const sharingRules = itemData.sharingCapacityRules || ensureSharingRules(maxAdults, maxOcc, []);
        const maxChildren = sharingRules.length > 0 ? Math.max(...sharingRules.map(r => parseInt(r.maxChildren) || 0)) : 0;
        const isTourStyle = isTourStyleCategory(itemData.category);
        const pricingModel = isTourStyle
          ? (itemData.pricingModel || 'per_vehicle')
          : (itemData.category === 'Accommodation' ? (itemData.pricingModel || 'per_person') : 'per_person');

        const itemPayload = {
          company_id: companyId,
          supplier_id: targetSupplierId,
          name: itemData.name,
          category: itemData.category,
          sub_category: isTourStyle ? (itemData.vehicleType || itemData.category) : itemData.category,
          transfer_type: itemData.category === 'Transfers' && dbFeatures.transferType ? (itemData.transferType || null) : null,
          description: itemData.description,
          currency: itemData.currency,
          pricing_model: pricingModel,
          max_occupancy: maxOcc,
          max_adults: isTourStyle ? maxOcc : maxAdults,
          max_children: isTourStyle ? 0 : maxChildren,
          sharing_capacity_rules: isTourStyle ? [] : sharingRules,
          child_age_ranges: isTourStyle
            ? [{ id: 'child', name: `Child (up to ${parseInt(itemData.childAge) || 12} yrs)`, ageFrom: 0, ageTo: (parseInt(itemData.childAge) || 12) }]
            : (itemData.childAgeRanges || []),
          images: itemData.imageUrls,
          ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
            ? { guide_driver_room_offered: !!itemData.guideDriverOffered }
            : {}),
          ...(dbFeatures.feeType
            ? {
                fee_type: (itemData.category === 'Accommodation' || itemData.category === 'Transfers') ? (itemData.feeType || 'none') : 'none',
                conservation_levy_basis: itemData.feeType === 'conservation' ? (itemData.levyBasis || 'per_night') : 'per_night'
              }
            : {}),
          ...(dbFeatures.contracts && (itemData.contractUrl || itemData.contractName)
            ? { contract_url: itemData.contractUrl || null, contract_name: itemData.contractName || null }
            : {})
        };

        // Determine target row: update existing (edit mode) or insert new
        const editingDbId = editingItems[itemData.tempId];
        let targetItemId;

        if (editingDbId) {
          const { data: updatedItem, error: itemErr } = await supabase
            .from('library_items')
            .update(itemPayload)
            .eq('id', editingDbId)
            .select()
            .single();

          if (itemErr) throw itemErr;
          targetItemId = updatedItem?.id || editingDbId;

          // Freshly replace all season rates for the edited item
          const { error: delErr } = await supabase
            .from('item_rates')
            .delete()
            .eq('item_id', targetItemId);

          if (delErr) throw delErr;
        } else {
          const { data: newItem, error: itemErr } = await supabase
            .from('library_items')
            .insert([itemPayload])
            .select()
            .single();

          if (itemErr) throw itemErr;
          targetItemId = newItem.id;
        }

        // Insert Seasons Pricing Matrices
        if (itemData.seasons.length > 0) {
          const ratesPayload = itemData.seasons.map(s => {
            if (isTourStyle) {
              const adultRate = parseFloat(s.adultRate) || 0;
              const vehicleRate = parseFloat(s.vehicleRate) || 0;
              const childRate = parseFloat(s.childRate) || 0;
              const isPerVehicle = pricingModel === 'per_vehicle';
              const isTiered = pricingModel === 'tiered';
              const tiers = Array.isArray(s.tiers) ? s.tiers
                .filter(t => t && (parseFloat(t.rate) > 0))
                .map(t => ({ min_pax: parseInt(t.minPax) || 0, max_pax: parseInt(t.maxPax) || 0, rate: parseFloat(t.rate) || 0 }))
                : [];
              return {
                item_id: targetItemId,
                option_name: s.seasonName || 'Base Season',
                season_name: s.seasonName || 'Base Season',
                meal_plan: null,
                currency: itemData.currency,
                valid_from: s.validFrom || null,
                valid_to: s.validTo || null,
                price_1_adult: !isTiered ? adultRate : null,
                price_2_adults: 0,
                price_3_plus_adults: 0,
                child_rates_breakdown: childRate > 0 ? { child: childRate } : {},
                single_supplement: 0,
                child_discount: 0,
                single_room_rate: 0,
                double_twin_rate: 0,
                effective_single_rate: 0,
                rate_basis: isPerVehicle ? 'per_vehicle' : (isTiered ? 'tiered' : 'per_person'),
                child_sharing_policy: '',
                unit_price: isPerVehicle ? adultRate : null,
                ...(dbFeatures.tieredPricing && isTiered ? { tiered_pricing: tiers } : {}),
                ...(dbFeatures.feeType
                  ? {
                      entrance_fee_per_person: itemData.feeType === 'entrance' ? (parseFloat(s.entranceFeePerson) || 0) : 0,
                      entrance_fee_per_vehicle: itemData.feeType === 'entrance' ? (parseFloat(s.entranceFeeVehicle) || 0) : 0,
                      conservation_levy_per_adult: itemData.feeType === 'conservation' ? (parseFloat(s.levyAdultRate) || 0) : 0,
                      conservation_levy_per_child: itemData.feeType === 'conservation' ? (parseFloat(s.levyChildRate) || 0) : 0
                    }
                  : {})
              };
            }
            const isFlatRoom = pricingModel === 'per_room';
            const roomRate = parseFloat(s.roomRate) || 0;
            const p1Adult = isFlatRoom ? roomRate : (parseFloat(s.price1Adult) || 0);
            const p2Adults = isFlatRoom ? roomRate : (parseFloat(s.price2Adults) || 0);
            const p3PlusAdults = isFlatRoom ? roomRate : (parseFloat(s.price3PlusAdults) || p2Adults);
            const childRatesMap = isFlatRoom ? {} : (s.childRates || {});
            const discount = isFlatRoom ? 0 : (parseFloat(s.childDiscount) || 0);

            return {
              item_id: targetItemId,
              option_name: s.seasonName || 'Base Season',
              season_name: s.seasonName || 'Base Season',
              meal_plan: itemData.mealPlan,
              currency: itemData.currency,
              valid_from: s.validFrom || null,
              valid_to: s.validTo || null,
              price_1_adult: p1Adult,
              price_2_adults: p2Adults,
              price_3_plus_adults: p3PlusAdults,
              child_rates_breakdown: childRatesMap,
              single_supplement: 0,
              child_discount: discount,
              single_room_rate: p1Adult,
              double_twin_rate: p2Adults,
              effective_single_rate: p1Adult,
              rate_basis: isFlatRoom ? 'per_room' : 'per_person_sharing',
              child_sharing_policy: isFlatRoom ? 'room_rate_divided' : 'sharing_with_adults',
              unit_price: isFlatRoom ? roomRate : (p2Adults || p1Adult || 0),
              ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
                ? { guide_rate: parseFloat(s.guideRate) || 0, driver_rate: parseFloat(s.driverRate) || 0 }
                : {}),
              ...(dbFeatures.guideDriver && itemData.category === 'Accommodation'
                ? { guide_meal_plan: s.guideMealPlan || itemData.mealPlan, driver_meal_plan: s.driverMealPlan || itemData.mealPlan }
                : {}),
              ...(dbFeatures.feeType
                ? {
                    entrance_fee_per_person: itemData.feeType === 'entrance' ? (parseFloat(s.entranceFeePerson) || 0) : 0,
                    entrance_fee_per_vehicle: itemData.feeType === 'entrance' ? (parseFloat(s.entranceFeeVehicle) || 0) : 0,
                    conservation_levy_per_adult: itemData.feeType === 'conservation' ? (parseFloat(s.levyAdultRate) || 0) : 0,
                    conservation_levy_per_child: itemData.feeType === 'conservation' ? (parseFloat(s.levyChildRate) || 0) : 0
                  }
                : {})
            };
          });

          const { error: ratesErr } = await supabase.from('item_rates').insert(ratesPayload);
          if (ratesErr) throw ratesErr;
        }
      }

      const isEditing = Object.keys(editingItems).length > 0;
      showToast(isEditing ? 'Library item updated successfully!' : `Successfully saved ${itemsToSave.length} Library Item(s)!`, 'success');
      setShowInlineForm(false);
      setEditingItems({});
      setSupplierMode('existing');
      setItemsToSave([createNewItemTemplate(1)]);
      fetchLibraryItems();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this library item?')) return;
    try {
      const { error } = await supabase.from('library_items').delete().eq('id', itemId);
      if (error) throw error;
      setLibraryItemsList(prev => prev.filter(item => item.id !== itemId));
      showToast('Library item deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Convert a DB library item (with merged item_rates) into the inline form template
  const buildItemFromRecord = (item) => {
    const rates = item.item_rates || [];
    const isTourStyle = isTourStyleCategory(item.category);
    const pricingModel = item.pricing_model || (item.category === 'Accommodation' ? 'per_person' : (item.category === 'Transfers' ? 'per_vehicle' : 'per_person'));
    const maxOcc = Math.max(1, parseInt(item.max_occupancy) || 2);
    const maxAdults = Math.max(1, parseInt(item.max_adults) || maxOcc);
    const childBands = Array.isArray(item.child_age_ranges) && item.child_age_ranges.length > 0
      ? item.child_age_ranges
      : createNewItemTemplate().childAgeRanges;

    const defaultChildRates = {};
    childBands.forEach(b => { defaultChildRates[b.id] = 0; });

    const seasons = rates.length > 0 ? rates.map(r => {
      if (isTourStyle) {
        const transferChildRate = parseFloat((r.child_rates_breakdown || {}).child) || 0;
        return {
          seasonName: r.season_name || r.option_name || 'Base Season',
          validFrom: r.valid_from || '',
          validTo: r.valid_to || '',
          adultRate: r.rate_basis === 'tiered' ? 0 : (parseFloat(r.price_1_adult) || parseFloat(r.unit_price) || 0),
          vehicleRate: 0,
          childRate: transferChildRate,
          tiers: Array.isArray(r.tiered_pricing) ? r.tiered_pricing.map(t => ({ minPax: t.min_pax ?? '', maxPax: t.max_pax ?? '', rate: t.rate ?? '' })) : [],
          roomRate: 0,
          price1Adult: 0,
          price2Adults: 0,
          price3PlusAdults: 0,
          childRates: {},
          singleSupplement: 0,
          childDiscount: 0,
          guideRate: 0,
          driverRate: 0,
          guideMealPlan: 'Bed & Breakfast',
          driverMealPlan: 'Bed & Breakfast',
          entranceFeePerson: parseFloat(r.entrance_fee_per_person) || 0,
          entranceFeeVehicle: parseFloat(r.entrance_fee_per_vehicle) || 0,
          levyAdultRate: parseFloat(r.conservation_levy_per_adult) || 0,
          levyChildRate: parseFloat(r.conservation_levy_per_child) || 0
        };
      }
      const isFlat = pricingModel === 'per_room' || r.rate_basis === 'per_room';
      return {
        seasonName: r.season_name || r.option_name || 'Base Season',
        validFrom: r.valid_from || '',
        validTo: r.valid_to || '',
        roomRate: isFlat ? (parseFloat(r.unit_price) || parseFloat(r.price_1_adult) || parseFloat(r.single_room_rate) || 0) : (parseFloat(r.single_room_rate) || 0),
        price1Adult: parseFloat(r.price_1_adult || r.single_room_rate) || 0,
        price2Adults: parseFloat(r.price_2_adults || r.double_twin_rate) || 0,
        price3PlusAdults: parseFloat(r.price_3_plus_adults) || 0,
        childRates: isFlat ? {} : (r.child_rates_breakdown || defaultChildRates),
        singleSupplement: parseFloat(r.single_supplement) || 0,
        childDiscount: isFlat ? 0 : (parseFloat(r.child_discount) || 0),
        guideRate: parseFloat(r.guide_rate) || 0,
        driverRate: parseFloat(r.driver_rate) || 0,
        guideMealPlan: r.guide_meal_plan || r.meal_plan || 'Bed & Breakfast',
        driverMealPlan: r.driver_meal_plan || r.meal_plan || 'Bed & Breakfast',
        entranceFeePerson: parseFloat(r.entrance_fee_per_person) || 0,
        entranceFeeVehicle: parseFloat(r.entrance_fee_per_vehicle) || 0,
        levyAdultRate: parseFloat(r.conservation_levy_per_adult) || 0,
        levyChildRate: parseFloat(r.conservation_levy_per_child) || 0
      };
    }) : [{
      seasonName: 'Base Season',
      validFrom: '',
      validTo: '',
      roomRate: 0,
      price1Adult: 0,
      price2Adults: 0,
      price3PlusAdults: 0,
      childRates: defaultChildRates,
      singleSupplement: 0,
      childDiscount: 0,
      guideRate: 0,
      driverRate: 0,
      guideMealPlan: 'Bed & Breakfast',
      driverMealPlan: 'Bed & Breakfast',
      adultRate: 0,
      childRate: 0,
      tiers: [],
      vehicleRate: 0,
      entranceFeePerson: 0,
      entranceFeeVehicle: 0,
      levyAdultRate: 0,
      levyChildRate: 0
    }];

    return {
      tempId: Date.now() + Math.random(),
      itemIndex: 1,
      name: item.name || '',
      category: item.category || 'Accommodation',
      currency: item.currency || 'ZAR',
      mealPlan: rates.find(r => r.meal_plan)?.meal_plan || 'Bed & Breakfast',
      vehicleType: isTourStyle ? (item.sub_category || '') : '',
      transferType: item.category === 'Transfers' ? (item.transfer_type || '') : '',
      feeType: (item.category === 'Accommodation' || item.category === 'Transfers') ? (item.fee_type || 'none') : 'none',
      levyBasis: item.conservation_levy_basis || 'per_night',
      childAge: isTourStyle ? (parseInt(childBands[0]?.ageTo) || 12) : 12,
      pricingModel,
      maxOccupancy: maxOcc,
      maxAdults,
      maxChildren: Math.max(0, parseInt(item.max_children) || 0),
      sharingCapacityRules: (Array.isArray(item.sharing_capacity_rules) && item.sharing_capacity_rules.length > 0)
        ? item.sharing_capacity_rules
        : ensureSharingRules(maxAdults, maxOcc, []),
      guideDriverOffered: item.guide_driver_room_offered === true,
      description: item.description || '',
      imageUrls: Array.isArray(item.images) ? item.images : [],
      newImageUrlInput: '',
      contractUrl: item.contract_url || '',
      contractName: item.contract_name || '',
      childAgeRanges: childBands,
      seasons
    };
  };

  const handleEditItem = (item) => {
    const template = buildItemFromRecord(item);
    setItemsToSave([template]);
    setEditingItems({ [template.tempId]: item.id });
    setSelectedSupplierId(item.supplier_id || item.supplier?.id || '');
    setSupplierMode('existing');
    setShowInlineForm(true);
    requestAnimationFrame(() => {
      const el = document.getElementById('library-item-form');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Filter list
  const filteredList = libraryItemsList.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
                          (item.suppliers?.name && item.suppliers.name.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      
      {/* Top Bar Header & Category Filters */}
      <header className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          
          {/* Search Box */}
          <div className="search-box" style={{ width: '380px', margin: 0 }}>
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search library items by name or supplier..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Category Filter Dropdown on Header Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ position: 'relative' }}>
              <select 
                className="pricing-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{
                  height: '42px',
                  margin: 0,
                  paddingRight: '2rem',
                  fontWeight: 600,
                  minWidth: '200px',
                  borderColor: '#cbd5e1'
                }}
              >
                <option value="All">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </div>

            {/* Toggle Add Library Item Inline Form */}
            <button 
              className="primary-btn" 
              style={{ width: 'auto', padding: '0.625rem 1.25rem', height: '42px', background: '#047857' }}
              onClick={() => setShowInlineForm(!showInlineForm)}
            >
              <Plus size={18} /> {showInlineForm ? 'Close Form' : '+ Add Library Item'}
            </button>
          </div>

        </div>
      </header>

      {/* FULL-WIDTH INLINE CREATION / EDIT FORM BLOCK (No Modals!) */}
      {showInlineForm && (
        <div id="library-item-form" style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem',
          border: '1px solid #cbd5e1',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
          marginBottom: '2.5rem',
          scrollMarginTop: '1rem'
        }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Package size={22} color="#047857" />
              {Object.keys(editingItems).length > 0 ? `Edit Library Item: ${itemsToSave[0]?.name || ''}` : 'Add New Library Item'}
            </h2>
            <button 
              onClick={() => { setShowInlineForm(false); setEditingItems({}); }} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
            >
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmitAllItems}>
            
            {/* INLINE SUPPLIER SELECTION / CREATION SECTION */}
            <div style={{
              background: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              marginBottom: '2rem'
            }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Building2 size={20} color="#047857" /> Supplier
                </h3>

                {/* Right Top Action Link */}
                {supplierMode === 'new' ? (
                  <button 
                    type="button" 
                    onClick={() => setSupplierMode('existing')} 
                    style={{ color: '#047857', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    Select Existing
                  </button>
                ) : (
                  <button 
                    type="button" 
                    onClick={() => setSupplierMode('new')} 
                    style={{ color: '#047857', background: 'none', border: 'none', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    + Add New Supplier
                  </button>
                )}
              </div>

              {/* MODE 1: Select Existing Supplier Dropdown */}
              {supplierMode === 'existing' && (
                <div style={{ maxWidth: '600px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                    Select Supplier *
                  </label>
                  <select 
                    className="pricing-select"
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    style={{ margin: 0, fontWeight: 600 }}
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.category || 'Supplier'})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* MODE 2: Full Inline New Supplier Form (Matching Screenshot) */}
              {supplierMode === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Basic Information */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Basic Information
                    </h4>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Supplier Name *
                        </label>
                        <input 
                          type="text" 
                          className="pricing-select"
                          placeholder="e.g., Safari Lodge Group"
                          required={supplierMode === 'new'}
                          value={supplierForm.name}
                          onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Contact Person
                        </label>
                        <input 
                          type="text" 
                          className="pricing-select"
                          placeholder="e.g., John Doe"
                          value={supplierForm.contactPerson}
                          onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Email
                          </label>
                          <input 
                            type="email" 
                            className="pricing-select"
                            placeholder="supplier@example.com"
                            value={supplierForm.email}
                            onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Phone
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="+27 123 456 789"
                            value={supplierForm.phone}
                            onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Website
                        </label>
                        <input 
                          type="text" 
                          className="pricing-select"
                          placeholder="https://www.example.com"
                          value={supplierForm.website}
                          onChange={(e) => setSupplierForm({ ...supplierForm, website: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Location */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Location
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          Address
                        </label>
                        <input 
                          type="text" 
                          className="pricing-select"
                          placeholder="123 Main Street"
                          value={supplierForm.address}
                          onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Country
                          </label>
                          <select 
                            className="pricing-select"
                            value={supplierForm.country}
                            onChange={(e) => setSupplierForm({ ...supplierForm, country: e.target.value })}
                          >
                            {countryOptions.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Province/State
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="Western Cape"
                            value={supplierForm.provinceState}
                            onChange={(e) => setSupplierForm({ ...supplierForm, provinceState: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            City
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="Cape Town"
                            value={supplierForm.city}
                            onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Banking Details */}
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                      Banking Details
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank Name
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="Standard Bank"
                            value={supplierForm.bankName}
                            onChange={(e) => setSupplierForm({ ...supplierForm, bankName: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Account Holder Name
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="Full name"
                            value={supplierForm.accountHolderName}
                            onChange={(e) => setSupplierForm({ ...supplierForm, accountHolderName: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank Account Number
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="123456789"
                            value={supplierForm.bankAccountNumber}
                            onChange={(e) => setSupplierForm({ ...supplierForm, bankAccountNumber: e.target.value })}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                            Bank/Branch Code
                          </label>
                          <input 
                            type="text" 
                            className="pricing-select"
                            placeholder="051001"
                            value={supplierForm.branchCode}
                            onChange={(e) => setSupplierForm({ ...supplierForm, branchCode: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ maxWidth: '450px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                          SWIFT/BIC/IBAN Code
                        </label>
                        <input 
                          type="text" 
                          className="pricing-select"
                          placeholder="SBZA ZA JJ"
                          value={supplierForm.swiftCode}
                          onChange={(e) => setSupplierForm({ ...supplierForm, swiftCode: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dedicated Save Supplier & Cancel Buttons */}
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-start', alignItems: 'center', marginTop: '0.5rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
                    <button 
                      type="button" 
                      onClick={handleSaveSupplierOnly} 
                      disabled={savingSupplier}
                      style={{
                        background: '#00665c',
                        border: 'none',
                        color: '#ffffff',
                        padding: '0.55rem 1.25rem',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        boxShadow: '0 2px 4px rgba(0,102,92,0.15)'
                      }}
                    >
                      <Check size={16} /> {savingSupplier ? 'Saving Supplier...' : 'Save Supplier'}
                    </button>
                    <button 
                      type="button" 
                      onClick={handleCancelSupplierForm} 
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#1e293b',
                        padding: '0.55rem 1.25rem',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '0.5rem' }}>
                      (Saving supplier enables library item creation below)
                    </span>
                  </div>

                </div>
              )}

            </div>

            {/* SUPPLIER REQUIRED / DISABLED BANNER IF NO SUPPLIER IS ESTABLISHED */}
            {!selectedSupplierId && (
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fde68a',
                color: '#92400e',
                padding: '0.85rem 1.25rem',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Building2 size={18} color="#b45309" />
                <span>Please select a supplier above, or click "+ Add New Supplier" and save it, to activate the library item form below.</span>
              </div>
            )}

            {/* LIBRARY ITEMS CONTAINER — Disabled / Grayed out until a supplier is selected or created */}
            <div style={{
              opacity: selectedSupplierId ? 1 : 0.45,
              pointerEvents: selectedSupplierId ? 'auto' : 'none',
              filter: selectedSupplierId ? 'none' : 'grayscale(0.6)',
              transition: 'all 0.25s ease'
            }}>

              {/* MULTI-ITEM CHECKBOX BANNER */}
              <div style={{
                background: '#eff6ff',
                padding: '0.85rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                marginBottom: '2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <input 
                  type="checkbox" 
                  id="addMultiple" 
                  checked={addMultiple} 
                  onChange={(e) => setAddMultiple(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <label htmlFor="addMultiple" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}>
                  Add multiple library items from this supplier at once
                </label>
              </div>

              {/* DYNAMIC LIBRARY ITEM CARDS */}
              {itemsToSave.map((item, itemIdx) => {
                const isTourStyle = isTourStyleCategory(item.category);
                return (
                <div 
                  key={item.tempId} 
                  style={{
                    background: '#fff',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
                    marginBottom: '2rem',
                    position: 'relative'
                  }}
                >
                  {/* Header for Item Card */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      Library Item {itemIdx + 1}
                    </h3>
                    {itemsToSave.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => handleRemoveItemCard(item.tempId)}
                        style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}
                      >
                        <Trash2 size={16} /> Remove Item
                      </button>
                    )}
                  </div>

                  {/* Category & Currency Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Category *
                      </label>
                      <select 
                        className="pricing-select"
                        value={item.category}
                        onChange={(e) => handleCategoryChange(item.tempId, e.target.value)}
                      >
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Currency *
                      </label>
                      <select 
                        className="pricing-select"
                        value={item.currency}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'currency', e.target.value)}
                      >
                        {currencies.length === 0 && (
                          <option value={item.currency}>{item.currency}</option>
                        )}
                        {currencies.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.code} – {c.name} ({c.symbol})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Name & Meal Plan / Vehicle Type Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                        Library Item Name *
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder={item.category === 'Transfers'
                          ? 'e.g., Airport Transfer / Safari Transfer'
                          : (item.category === 'Activities / Tours'
                            ? 'e.g., Game Drive / Boat Cruise / Guided Walk'
                            : 'e.g., Standard Room / Safari Transfer / Game Drive')}
                        required
                        value={item.name}
                        onChange={(e) => handleItemFieldChange(item.tempId, 'name', e.target.value)}
                      />
                    </div>

                    {isTourStyle ? (
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                          Vehicle Type *
                        </label>
                        <select 
                          className="pricing-select"
                          value={item.vehicleType}
                          onChange={(e) => handleVehicleTypeChange(item.tempId, e.target.value)}
                        >
                          <option value="">Select vehicle type...</option>
                          {vehicleOptions.map(v => (
                            <option key={v.label} value={v.label}>{v.label}</option>
                          ))}
                        </select>
                      </div>
                    ) : item.category === 'Accommodation' ? (
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                          Meal Plan
                        </label>
                        <select 
                          className="pricing-select"
                          value={item.mealPlan}
                          onChange={(e) => handleItemFieldChange(item.tempId, 'mealPlan', e.target.value)}
                        >
                          {mealPlanOptions.map(mp => (
                            <option key={mp} value={mp}>{mp}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  {/* GUIDE / DRIVER ROOM RATE TOGGLE (Accommodation only) */}
                  {item.category === 'Accommodation' && !dbFeatures.guideDriver && (
                    <div style={{
                      background: '#fefce8',
                      border: '1px solid #facc15',
                      borderRadius: '10px',
                      padding: '0.75rem 1.15rem',
                      marginBottom: '1.25rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#854d0e'
                    }}>
                      Guide/Driver room rates will be available after the database migration is applied
                      (20260829_guide_driver_room_rates.sql).
                    </div>
                  )}
                  {item.category === 'Accommodation' && dbFeatures.guideDriver && (
                    <div style={{
                      background: item.guideDriverOffered ? '#fffbeb' : '#f8fafc',
                      border: item.guideDriverOffered ? '1px solid #fde68a' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '0.85rem 1.15rem',
                      marginBottom: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                        <Hotel size={18} color={item.guideDriverOffered ? '#d97706' : '#64748b'} />
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                            Guide / Driver Room
                          </span>
                          <span style={{ fontSize: '0.74rem', color: item.guideDriverOffered ? '#a16207' : '#64748b' }}>
                            {item.guideDriverOffered
                              ? 'Enter separate guide & driver room rates in each season below.'
                              : 'Not offered — guide & driver automatically use the Single Room rate.'}
                          </span>
                        </div>
                      </div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={item.guideDriverOffered || false}
                          onChange={(e) => handleItemFieldChange(item.tempId, 'guideDriverOffered', e.target.checked)}
                          style={{ width: '17px', height: '17px', accentColor: '#d97706', cursor: 'pointer' }}
                        />
                        Hotel offers Guide/Driver rate
                      </label>
                    </div>
                  )}

                  {/* TRANSFER TYPE SELECTOR */}
                  {item.category === 'Transfers' && (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Navigation size={18} color="#863bff" /> Transfer Type <span style={{ color: '#ef4444' }}>*</span>
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Each type is priced differently, so pick the one that matches how this transfer is used.
                        </span>
                      </div>

                      {!dbFeatures.transferType && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Transfer Type will be saved after the database migration is applied (20260829_transfer_type.sql).
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                        {transferTypes.map(tt => {
                          const selected = item.transferType === tt.id;
                          return (
                            <button
                              key={tt.id}
                              type="button"
                              onClick={() => handleItemFieldChange(item.tempId, 'transferType', tt.id)}
                              style={{
                                background: selected ? '#f5f3ff' : '#f8fafc',
                                border: selected ? '2px solid #a855f7' : '1px solid #e2e8f0',
                                borderRadius: '10px',
                                padding: '0.75rem 0.85rem',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: selected ? '#7c3aed' : '#1e293b', display: 'block' }}>
                                {tt.icon} {tt.label} {selected && '✓'}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {tt.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MAXIMUM OCCUPANCY & CAPACITY CARD */}
                  {isTourStyle ? (
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                      <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Bus size={18} color="#3b82f6" /> {item.category === 'Transfers' ? 'Vehicle Capacity' : 'Transport Capacity'}
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          {item.category === 'Transfers'
                            ? 'Maximum number of passengers (pax) allowed in this vehicle.'
                            : 'Maximum number of passengers (pax) per activity / tour departure.'}
                        </span>
                      </div>
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1', minWidth: '180px' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Maximum Occupancy</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Max pax allowed (auto-filled from vehicle type, editable)</span>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center', marginTop: '0.35rem' }}
                            value={item.maxOccupancy}
                            onChange={(e) => {
                              const newMax = Math.max(1, parseInt(e.target.value) || 1);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) return { ...it, maxOccupancy: newMax };
                                return it;
                              }));
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 700, paddingBottom: '0.5rem' }}>Max Pax</span>
                      </div>
                      {item.vehicleType && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e40af', marginTop: '1rem' }}>
                          🚐 <strong>{item.vehicleType}</strong> — accommodates up to <strong>{item.maxOccupancy} pax</strong>.
                        </div>
                      )}
                    </div>
                  ) : item.category === 'Accommodation' ? (
                  <div style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    marginBottom: '1.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Users size={18} color="#00665c" /> Room Occupancy & Capacity Limits
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Configure maximum capacity per room for all-adult parties and conditional child sharing allowances.
                      </span>
                    </div>

                    {/* Overall Capacity Ceilings Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                      
                      {/* Max Total Capacity */}
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ marginBottom: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Max Total Capacity</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Overall room limit (Adults + Children)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center' }}
                            value={item.maxOccupancy}
                            onChange={(e) => {
                              const newMax = Math.max(1, parseInt(e.target.value) || 1);
                              const newAdults = Math.min(newMax, parseInt(item.maxAdults) || 2);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) {
                                  const updatedRules = ensureSharingRules(newAdults, newMax, it.sharingCapacityRules);
                                  return {
                                    ...it,
                                    maxOccupancy: newMax,
                                    maxAdults: newAdults,
                                    sharingCapacityRules: updatedRules
                                  };
                                }
                                return it;
                              }));
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Guests</span>
                        </div>
                      </div>

                      {/* Max Adults Limit */}
                      <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ marginBottom: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>Max Adults Limit</span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Limit when occupied by adults only</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <input
                            type="number"
                            min="1"
                            max={item.maxOccupancy || 20}
                            className="pricing-select"
                            style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center' }}
                            value={item.maxAdults !== undefined ? item.maxAdults : item.maxOccupancy}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              const capped = Math.min(parseInt(item.maxOccupancy) || 2, val);
                              setItemsToSave(prev => prev.map(it => {
                                if (it.tempId === item.tempId) {
                                  const updatedRules = ensureSharingRules(capped, it.maxOccupancy, it.sharingCapacityRules);
                                  return {
                                    ...it,
                                    maxAdults: capped,
                                    sharingCapacityRules: updatedRules
                                  };
                                }
                                return it;
                              }));
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Adults</span>
                        </div>
                      </div>

                    </div>

                    {/* Conditional Sharing Capacity Controller */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                          Child Sharing Rules per Adult Count
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          Specify how many children are permitted to share when the room has 1, 2, or 3 adults.
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, item.maxOccupancy || 2, [])).map((rule) => {
                          const currentAdults = rule.adults;
                          const maxAllowedForThisRow = Math.max(0, (parseInt(item.maxOccupancy) || 2) - currentAdults);
                          const childrenVal = Math.min(maxAllowedForThisRow, Math.max(0, parseInt(rule.maxChildren) || 0));
                          const effectiveTotal = currentAdults + childrenVal;

                          return (
                            <div key={currentAdults} style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              padding: '0.55rem 0.85rem',
                              flexWrap: 'wrap',
                              gap: '0.5rem'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{
                                  background: '#00665c',
                                  color: '#ffffff',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  padding: '0.2rem 0.55rem',
                                  borderRadius: '4px'
                                }}>
                                  {currentAdults} {currentAdults === 1 ? 'Adult' : 'Adults'}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600 }}>
                                  in room allows:
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Max Children:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max={maxAllowedForThisRow}
                                    value={rule.maxChildren !== undefined ? rule.maxChildren : childrenVal}
                                    onChange={(e) => handleSharingRuleChange(item.tempId, currentAdults, e.target.value)}
                                    style={{ width: '60px', padding: '0.25rem 0.4rem', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '5px' }}
                                  />
                                </div>

                                <span style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  color: childrenVal === 0 ? '#b45309' : '#15803d',
                                  background: childrenVal === 0 ? '#fffbeb' : '#f0fdf4',
                                  padding: '0.25rem 0.6rem',
                                  borderRadius: '5px',
                                  border: `1px solid ${childrenVal === 0 ? '#fde68a' : '#bbf7d0'}`
                                }}>
                                  {childrenVal === 0
                                    ? `Max ${effectiveTotal} Guests (${currentAdults} Adults only, No children)`
                                    : `Max ${effectiveTotal} Guests (${currentAdults} Adults + ${childrenVal} Child${childrenVal > 1 ? 'ren' : ''})`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Capacity Summary Badge */}
                    <div style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      fontSize: '0.8rem',
                      color: '#166534',
                      marginBottom: '1.25rem'
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        💡 Capacity & Sharing Rules Summary:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginLeft: '0.5rem' }}>
                        {(item.sharingCapacityRules || ensureSharingRules(item.maxAdults || 2, item.maxOccupancy || 2, [])).map(r => {
                          const ch = Math.max(0, parseInt(r.maxChildren) || 0);
                          return (
                            <div key={r.adults}>
                              • <strong>{r.adults} {r.adults === 1 ? 'Adult' : 'Adults'}:</strong> {ch === 0 ? '0 Children (Max ' + r.adults + ' Guests only)' : 'Up to ' + ch + ' Child' + (ch > 1 ? 'ren' : '') + ' sharing (Max ' + (r.adults + ch) + ' Guests)'}
                            </div>
                          );
                        })}
                        <div style={{ marginTop: '0.2rem', color: '#15803d', fontWeight: 600 }}>
                          • Overall Room Ceiling: <strong>{item.maxOccupancy || 2} Total Guests</strong>
                        </div>
                      </div>
                    </div>

                    {/* ── Child Age Range Configuration (per supplier contract) ── */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                          Child Age Ranges (per supplier contract)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddChildAgeBand(item.tempId)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', background: '#f0fdf4', color: '#00665c', border: '1px solid #bbf7d0', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          + Add Age Tier
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {(item.childAgeRanges || []).map((band, bandIdx) => (
                          <div key={band.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '0.45rem 0.65rem' }}>
                            <input
                              type="text"
                              value={band.name}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'name', e.target.value)}
                              placeholder="Name"
                              style={{ flex: '1', minWidth: '80px', fontSize: '0.8rem', padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '5px', fontWeight: 600, color: '#1e293b' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Ages</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageFrom}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageFrom', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>–</span>
                            <input
                              type="number"
                              min="0"
                              value={band.ageTo}
                              onChange={(e) => handleUpdateChildAgeBand(item.tempId, bandIdx, 'ageTo', e.target.value)}
                              style={{ width: '52px', fontSize: '0.8rem', padding: '0.25rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '5px', textAlign: 'center' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>yrs</span>
                            {(item.childAgeRanges || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveChildAgeBand(item.tempId, bandIdx)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.1rem', lineHeight: 1 }}
                                title="Remove age tier"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                  ) : null}

                  {/* PRICING MODEL SELECTOR */}
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '0.85rem 1.15rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                  }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Tag size={16} color="#00665c" /> {isTourStyle
                          ? (item.category === 'Transfers' ? 'Transfer Pricing Type:' : 'Activity / Tour Pricing Type:')
                          : (item.category === 'Accommodation' ? 'Accommodation Pricing Model:' : 'Pricing Type:')}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                        {isTourStyle
                          ? 'Choose how the rate is quoted: per vehicle, per person, or tiered by pax count.'
                          : 'Choose whether rates are quoted per person sharing or as a flat room/unit price.'}
                      </span>
                    </div>

                    {isTourStyle ? (
                      <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                        {transferPricingOptions.map(opt => (
                          (opt.id === 'tiered' && !dbFeatures.tieredPricing) ? null : (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', opt.id)}
                              style={{
                                padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                                background: item.pricingModel === opt.id ? '#ffffff' : 'transparent',
                                color: item.pricingModel === opt.id ? '#1d4ed8' : '#64748b',
                                boxShadow: item.pricingModel === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                              }}
                            >
                              {opt.label}
                            </button>
                          )
                        ))}
                      </div>
                    ) : (
                    <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', 'per_person')}
                        style={{
                          padding: '0.4rem 0.9rem',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          background: (item.pricingModel || 'per_person') === 'per_person' ? '#ffffff' : 'transparent',
                          color: (item.pricingModel || 'per_person') === 'per_person' ? '#00665c' : '#64748b',
                          boxShadow: (item.pricingModel || 'per_person') === 'per_person' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        👥 Per Person Sharing (PPS)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleItemFieldChange(item.tempId, 'pricingModel', 'per_room')}
                        style={{
                          padding: '0.4rem 0.9rem',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          background: item.pricingModel === 'per_room' ? '#ffffff' : 'transparent',
                          color: item.pricingModel === 'per_room' ? '#00665c' : '#64748b',
                          boxShadow: item.pricingModel === 'per_room' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        🏠 Flat Room / Unit Rate
                      </button>
                    </div>
                    )}
                  </div>

                  {/* SURCHARGE FEES SELECTOR (Accommodation + Transfers) */}
                  {dbFeatures.feeType && (item.category === 'Accommodation' || item.category === 'Transfers') ? (
                    <div style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '0.85rem 1.15rem',
                      marginBottom: '1.5rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Tag size={16} color="#0d9488" /> Surcharge Fees:
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                            {item.feeType === 'entrance'
                              ? 'Entrance fees are charged per person and/or per vehicle — set the relevant rate(s) for each season below.'
                              : (item.feeType === 'conservation'
                                ? 'Conservation levies are charged per adult and per child — set the relevant rate(s) for each season below.'
                                : 'Optionally add entrance fees or a conservation levy on top of the base rates.')}
                          </span>
                        </div>
                        <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px', flexWrap: 'wrap' }}>
                          {(feeTypeOptions[item.category === 'Transfers' ? 'transfers' : 'accommodation'] || []).map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleItemFieldChange(item.tempId, 'feeType', opt.id)}
                              style={{
                                padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                                background: (item.feeType || 'none') === opt.id ? '#ffffff' : 'transparent',
                                color: (item.feeType || 'none') === opt.id ? '#0f766e' : '#64748b',
                                boxShadow: (item.feeType || 'none') === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {item.feeType === 'conservation' && (
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Levy Charged:</span>
                          <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '3px' }}>
                            {levyBasisOptions.map(opt => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleItemFieldChange(item.tempId, 'levyBasis', opt.id)}
                                style={{
                                  padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
                                  background: (item.levyBasis || 'per_night') === opt.id ? '#ffffff' : 'transparent',
                                  color: (item.levyBasis || 'per_night') === opt.id ? '#0f766e' : '#64748b',
                                  boxShadow: (item.levyBasis || 'per_night') === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Seasonal Pricing Matrices Box */}
                  <div style={{
                    background: '#f8fafc',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    border: '1px solid #e2e8f0',
                    marginBottom: '1.5rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Calendar size={18} color="#863bff" /> {isTourStyle
                          ? `Seasonal Price Matrices (${item.pricingModel === 'tiered' ? 'Tiered by Pax Count' : item.pricingModel === 'per_vehicle' ? 'Flat Vehicle Rate' : 'Per Person Rates'})`
                          : `Seasonal Pricing Matrices ${item.pricingModel === 'per_room' ? '(Flat Room Rates)' : '(Per Person Rates)'}`}
                      </h4>
                    </div>

                    {/* Rate Guide */}
                    {item.feeType === 'entrance' && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#0d9488', marginBottom: '0.2rem' }}>🎟️ Entrance Fee Rates:</div>
                        <div>• <strong>Per Person:</strong> charged for each visitor entering.</div>
                        <div>• <strong>Per Vehicle:</strong> charged once per vehicle/departure (e.g. park entry per car).</div>
                        <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.25rem' }}>
                          Both can be set at once — the itinerary builder can apply either one or both together.
                        </div>
                      </div>
                    )}
                    {item.feeType === 'conservation' && (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#0d9488', marginBottom: '0.2rem' }}>🌿 Conservation Levy Rates:</div>
                        <div>• <strong>Adult Rate:</strong> charged per adult{item.levyBasis === 'per_stay' ? ' per stay' : ' per night'}.</div>
                        <div>• <strong>Child Rate:</strong> charged per child (up to the child age set below){item.levyBasis === 'per_stay' ? ' per stay' : ' per night'}.</div>
                        <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.25rem' }}>
                          Levies are applied {item.levyBasis === 'per_stay' ? 'once for the stay' : 'nightly for the duration of the stay'}.
                        </div>
                      </div>
                    )}
                    {isTourStyle ? (
                      item.pricingModel === 'tiered' ? (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>📊 Tiered Pricing Model:</div>
                          <div>Contract charges different rates depending on how many passengers are in the vehicle.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Add pax bands (e.g. 1–3 pax → R 2,500; 4+ pax → R 3,200). Child rate is optional.
                          </div>
                        </div>
                      ) : item.pricingModel === 'per_vehicle' ? (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>🚐 Flat Rate (Per Vehicle):</div>
                          <div>Contract charges a fixed rate per vehicle per trip for up to <strong>{item.maxOccupancy || 4} pax</strong>, regardless of mix.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Child rate is optional. Total trip price = vehicle rate (or per person × pax when sharing is requested).
                          </div>
                        </div>
                      ) : (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.2rem' }}>👤 Per-Person Transfer Rate:</div>
                          <div>Contract charges per passenger. Add adult rate and an optional child rate.</div>
                          <div style={{ color: '#1e40af', fontWeight: 600, marginTop: '0.25rem' }}>
                            Child rate applies to passengers up to the child age set below.
                          </div>
                        </div>
                      )
                    ) : (
                    item.pricingModel === 'per_room' ? (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#166534', marginBottom: '0.2rem' }}>💡 Flat Room Rate Model:</div>
                        <div>Contract charges a fixed rate per room/unit per night for up to <strong>{item.maxOccupancy || 2} Total Guests</strong> (regardless of adult or child mix).</div>
                        <div style={{ color: '#00665c', fontWeight: 600, marginTop: '0.25rem' }}>
                          In the Itinerary Builder, the per-person rate is automatically derived as: <code>Room Rate ÷ Number of Occupants</code>.
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#475569', lineHeight: '1.45' }}>
                        <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.2rem' }}>💡 Per-Person Catalog Rates:</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.35rem', marginTop: '0.2rem' }}>
                          <div>• <strong>1 Adult:</strong> Single Room rate (per person)</div>
                          <div>• <strong>2 Adults:</strong> Per Person Sharing (PPS) rate (each adult sharing)</div>
                          <div>• <strong>3+ Adults:</strong> Extra Adult rate (each additional adult sharing)</div>
<div>• <strong>Children:</strong> Rate per child by age tier (sharing with adult/s)</div>
                        </div>
                      </div>
                    ))}

                    {item.seasons.map((season, seasonIdx) => {
                      const bands = item.childAgeRanges || [];
                      const isFlatRoom = item.pricingModel === 'per_room';

                      return (
                        <div key={seasonIdx} style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#475569' }}>
                              Season {seasonIdx + 1} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({season.seasonName})</span>
                            </span>
                            {item.seasons.length > 1 && (
                              <button type="button" onClick={() => handleRemoveSeasonRow(item.tempId, seasonIdx)}
                                style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>
                                <Trash2 size={14} /> Remove Season
                              </button>
                            )}
                          </div>

                          {/* Season Name & Dates */}
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Season Name</label>
                              <input type="text" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                placeholder="e.g. Base / High Season"
                                value={season.seasonName}
                                onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'seasonName', e.target.value)} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Valid From</label>
                              <input type="date" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                value={season.validFrom}
                                onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'validFrom', e.target.value)} />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Valid To</label>
                              <input type="date" className="pricing-select" style={{ padding: '0.4rem', fontSize: '0.85rem' }}
                                value={season.validTo}
                                onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'validTo', e.target.value)} />
                            </div>
                          </div>

                          {/* Flat Room Rate Input OR PPS Tier Inputs */}
                          {isTourStyle ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              {item.pricingModel === 'tiered' ? (
                                <>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                                    Tiered Rates by Pax Count ({item.currency})
                                  </label>
                                  {(season.tiers || []).map((tier, tierIdx) => (
                                    <div key={`${seasonIdx}-t${tierIdx}`} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Min Pax</span>
                                        <input
                                          type="number"
                                          min="1"
                                          className="pricing-select"
                                          style={{ width: '80px', padding: '0.35rem' }}
                                          value={tier.minPax ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'minPax', e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Max Pax</span>
                                        <input
                                          type="number"
                                          min="1"
                                          className="pricing-select"
                                          style={{ width: '80px', padding: '0.35rem' }}
                                          value={tier.maxPax ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'maxPax', e.target.value)}
                                        />
                                      </div>
                                      <div>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, display: 'block' }}>Rate ({item.currency})</span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="pricing-select"
                                          style={{ width: '120px', padding: '0.35rem' }}
                                          placeholder="e.g. 3000"
                                          value={tier.rate ?? ''}
                                          onChange={(e) => handleUpdateTier(item.tempId, seasonIdx, tierIdx, 'rate', e.target.value)}
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveTier(item.tempId, seasonIdx, tierIdx)}
                                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.4rem', lineHeight: 1 }}
                                        title="Remove tier"
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => handleAddTierRow(item.tempId, seasonIdx)}
                                    style={{ background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '6px', color: '#1d4ed8', padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                                  >
                                    <Plus size={14} /> Add Pax Tier
                                  </button>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.6rem' }}>
                                    Example: 1–3 pax → R 2,500 / 4–7 pax → R 3,200. The itinerary builder picks the band matching the passenger count.
                                  </div>
                                </>
                              ) : item.pricingModel === 'per_vehicle' ? (
                                <div>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                    Vehicle Rate per Trip ({item.currency})
                                  </label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                      placeholder="e.g. 3000"
                                      value={season.adultRate !== undefined ? season.adultRate : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Vehicle</span>
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                    Flat price for up to <strong>{item.maxOccupancy || 4} pax</strong>. In quotes, per-person rate is: <code>{item.currency} {parseFloat(season.adultRate) || 0} ÷ (Passengers)</code>.
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                    Rate per Person ({item.currency})
                                  </label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      className="pricing-select"
                                      style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                      placeholder="e.g. 850"
                                      value={season.adultRate !== undefined ? season.adultRate : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'adultRate', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Person</span>
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                    Charged per passenger in the vehicle.
                                  </div>
                                </div>
                              )}

                              {/* Child Rate (Optional) */}
                              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ maxWidth: '200px', flex: '1' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency}) (Optional)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    placeholder="Leave blank for no child rate"
                                    value={season.childRate !== undefined ? season.childRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childRate', e.target.value)}
                                  />
                                </div>
                                <div style={{ maxWidth: '200px', flex: '1' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Age Limit (yrs)
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="17"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={item.childAge || 12}
                                    onChange={(e) => handleItemFieldChange(item.tempId, 'childAge', e.target.value)}
                                  />
                                </div>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.5rem' }}>
                                Child rate applies to passengers up to {item.childAge || 12} years old. Children below 1 year usually travel free — confirm with supplier contract.
                              </div>
                            </div>
                          ) : (
                          isFlatRoom ? (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                                Room / Unit Rate per Night ({item.currency})
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', maxWidth: '320px' }}>
                                <input 
                                  type="number" 
                                  className="pricing-select"
                                  style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700 }}
                                  placeholder={`e.g. 5000`}
                                  value={season.roomRate !== undefined ? season.roomRate : ''}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'roomRate', e.target.value)}
                                />
                                <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>/ Room / Night</span>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                Flat price for up to <strong>{item.maxOccupancy || 2} Persons</strong>. In quotes, rate per person is: <code>{item.currency} {parseFloat(season.roomRate) || 0} ÷ (Occupants)</code>.
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Adults Pricing */}
                              <div style={{ marginBottom: '1rem' }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                  Adults Pricing (Per Person — {item.currency})
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>1 Adult (Single Room)</span>
                                    <input 
                                      type="number" 
                                      className="pricing-select"
                                      style={{ padding: '0.35rem' }}
                                      placeholder={`Price (${item.currency})`}
                                      value={season.price1Adult}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price1Adult', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>1 Adult Single rate</span>
                                  </div>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>2 Adults (Double/Twin)</span>
                                    <input 
                                      type="number" 
                                      className="pricing-select"
                                      style={{ padding: '0.35rem' }}
                                      placeholder={`Price (${item.currency})`}
                                      value={season.price2Adults}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price2Adults', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Per Person Sharing (PPS)</span>
                                  </div>
                                  <div>
                                    <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>3+ Adults (Per Person)</span>
                                    <input 
                                      type="number" 
                                      className="pricing-select"
                                      style={{ padding: '0.35rem' }}
                                      placeholder={`Price (${item.currency})`}
                                      value={season.price3PlusAdults !== undefined ? season.price3PlusAdults : ''}
                                      onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'price3PlusAdults', e.target.value)}
                                    />
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Extra adult sharing</span>
                                  </div>
                                </div>
                              </div>

                              {/* Children Pricing per Age Range */}
                              {bands.length > 0 && (
                                <div style={{ marginBottom: '1rem' }}>
                                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                                    Children Pricing per Age Range (Per Person — {item.currency})
                                  </label>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                    {bands.map((band) => (
                                      <div key={band.id}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, display: 'block' }}>
                                          {band.name} ({band.ageFrom}–{band.ageTo} yrs)
                                        </span>
                                        <input 
                                          type="number" 
                                          className="pricing-select"
                                          style={{ padding: '0.35rem' }}
                                          placeholder={`Price (${item.currency})`}
                                          value={season.childRates?.[band.id] !== undefined ? season.childRates[band.id] : ''}
                                          onChange={(e) => handleChildRateChange(item.tempId, seasonIdx, band.id, e.target.value)}
                                        />
                                        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Sharing with adult/s</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Optional Child Discount */}
                              <div style={{ maxWidth: '300px', marginTop: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                  Child Discount (%) (Optional)
                                </label>
                                <input 
                                  type="number" 
                                  className="pricing-select"
                                  style={{ padding: '0.35rem' }}
                                  placeholder="e.g. 10%"
                                  value={season.childDiscount}
                                  onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'childDiscount', e.target.value)}
                                />
                              </div>
                            </>
                          ))}

                          {/* Surcharge Fee Inputs (per season) */}
                          {item.feeType === 'entrance' && (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534', display: 'block', marginBottom: '0.5rem' }}>
                                🎟️ Entrance Fee Rates ({item.currency})
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', maxWidth: '480px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Per Person Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 850"
                                    value={season.entranceFeePerson !== undefined ? season.entranceFeePerson : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'entranceFeePerson', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per visitor</span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Per Vehicle Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 1200"
                                    value={season.entranceFeeVehicle !== undefined ? season.entranceFeeVehicle : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'entranceFeeVehicle', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged once per vehicle</span>
                                </div>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.45rem' }}>
                                Set either rate, or both — the itinerary builder applies whichever rate(s) match the booking.
                              </div>
                            </div>
                          )}
                          {item.feeType === 'conservation' && (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
                              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534', display: 'block', marginBottom: '0.5rem' }}>
                                🌿 Conservation Levy Rates ({item.currency}) — {item.levyBasis === 'per_stay' ? 'Per Stay' : 'Per Night'}
                              </label>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', maxWidth: '480px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Adult Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 120"
                                    value={season.levyAdultRate !== undefined ? season.levyAdultRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'levyAdultRate', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per adult{item.levyBasis === 'per_stay' ? ' per stay' : ' per night'}</span>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Rate ({item.currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.45rem 0.75rem', fontSize: '1rem', fontWeight: 700, width: '100%' }}
                                    placeholder="e.g. 60"
                                    value={season.levyChildRate !== undefined ? season.levyChildRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'levyChildRate', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>Charged per child{item.levyBasis === 'per_stay' ? ' per stay' : ' per night'}</span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ maxWidth: '200px', flex: '1' }}>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                                    Child Age Limit (yrs)
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="17"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={item.childAge || 12}
                                    onChange={(e) => handleItemFieldChange(item.tempId, 'childAge', e.target.value)}
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Guide & Driver Room Rates (Accommodation, offered hotels only) */}
                          {item.category === 'Accommodation' && item.guideDriverOffered && dbFeatures.guideDriver && (
                            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.85rem 1rem', marginTop: '1rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#92400e', display: 'block', marginBottom: '0.5rem' }}>
                                🚌 Guide & Driver Room Rates (per night — {item.currency})
                              </span>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block' }}>Guide Room Rate</span>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    placeholder={`Rate (${item.currency})`}
                                    value={season.guideRate !== undefined ? season.guideRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideRate', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.68rem', color: '#b45309', display: 'block' }}>0 = fall back to Single rate</span>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block', marginTop: '0.45rem' }}>
                                    Guide Meal Plan (same as clients)
                                  </span>
                                  <select
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={season.guideMealPlan || item.mealPlan}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'guideMealPlan', e.target.value)}
                                  >
                                    {mealPlanOptions.map(mp => (
                                      <option key={mp} value={mp}>{mp}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block' }}>Driver Room Rate</span>
                                  <input
                                    type="number"
                                    min="0"
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    placeholder={`Rate (${item.currency})`}
                                    value={season.driverRate !== undefined ? season.driverRate : ''}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'driverRate', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.68rem', color: '#b45309', display: 'block' }}>0 = fall back to Single rate</span>
                                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontWeight: 600, display: 'block', marginTop: '0.45rem' }}>
                                    Driver Meal Plan (same as clients)
                                  </span>
                                  <select
                                    className="pricing-select"
                                    style={{ padding: '0.35rem' }}
                                    value={season.driverMealPlan || item.mealPlan}
                                    onChange={(e) => handleSeasonChange(item.tempId, seasonIdx, 'driverMealPlan', e.target.value)}
                                  >
                                    {mealPlanOptions.map(mp => (
                                      <option key={mp} value={mp}>{mp}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          )}

                        </div>
                      );
                    })}

                    <button 
                      type="button" 
                      className="secondary-btn" 
                      style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                      onClick={() => handleAddSeasonRow(item.tempId)}
                    >
                      + Add Season
                    </button>
                  </div>

                  {/* Description Field */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                      Description
                    </label>
                    <textarea 
                      className="pricing-select"
                      style={{ minHeight: '80px', fontFamily: 'inherit', padding: '0.75rem' }}
                      placeholder="Detailed description of the library item..."
                      value={item.description}
                      onChange={(e) => handleItemFieldChange(item.tempId, 'description', e.target.value)}
                    />
                  </div>

                  {/* Gallery Images (Max 10) Field - Matching Screenshot Design */}
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.5rem' }}>
                      Gallery Images (Max 10)
                    </label>
                    
                    <input 
                      type="file" 
                      id={`file-input-${item.tempId}`}
                      multiple 
                      accept=".jpg,.jpeg,image/jpeg"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        handleImageFilesUpload(item.tempId, e.target.files);
                        e.target.value = '';
                      }}
                    />

                    <div 
                      onClick={() => {
                        if (item.imageUrls.length >= 10) {
                          showToast('Maximum 10 images reached', 'warning');
                          return;
                        }
                        document.getElementById(`file-input-${item.tempId}`)?.click();
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleImageFilesUpload(item.tempId, e.dataTransfer.files);
                      }}
                      style={{
                        border: '1.5px dashed #cbd5e1',
                        borderRadius: '8px',
                        background: '#fafbfc',
                        padding: '2rem 1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: item.imageUrls.length >= 10 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s ease',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                      onMouseEnter={(e) => {
                        if (item.imageUrls.length < 10) e.currentTarget.style.borderColor = '#94a3b8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                    >
                      <div style={{ color: '#475569', marginBottom: '0.5rem' }}>
                        <UploadCloud size={32} strokeWidth={1.5} />
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#334155', marginBottom: '0.25rem' }}>
                        Click to upload images
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {item.imageUrls.length}/10 images
                      </div>
                    </div>

                    {/* Image Thumbnails Grid */}
                    {item.imageUrls.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        {item.imageUrls.map((imgUrl, imgIdx) => (
                          <div key={imgIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                            <div style={{ position: 'relative', width: '84px', height: '84px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                              <img 
                                src={imgUrl} 
                                alt={`Gallery ${imgIdx + 1}`} 
                                onClick={() => setLightbox({ images: item.imageUrls, index: imgIdx })}
                                title="Click to enlarge"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} 
                              />
                              <button 
                                type="button" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveImage(item.tempId, imgIdx);
                                }}
                                style={{ position: 'absolute', top: '3px', right: '3px', background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Remove image"
                              >
                                <X size={12} />
                              </button>
                              <span style={{ position: 'absolute', bottom: '2px', left: '4px', fontSize: '0.65rem', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: '3px' }}>
                                #{imgIdx + 1}
                              </span>
                            </div>
                            {item.imageUrls.length > 1 && (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleMoveImage(item.tempId, imgIdx, -1)}
                                  disabled={imgIdx === 0}
                                  title="Move image left"
                                  style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#1e293b', width: '26px', height: '26px', borderRadius: '6px', cursor: imgIdx === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, opacity: imgIdx === 0 ? 0.4 : 1 }}
                                >
                                  <ChevronLeft size={14} />
                                </button>
                                <span style={{ fontSize: '0.65rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{imgIdx + 1}/{item.imageUrls.length}</span>
                                <button
                                  type="button"
                                  onClick={() => handleMoveImage(item.tempId, imgIdx, 1)}
                                  disabled={imgIdx === item.imageUrls.length - 1}
                                  title="Move image right"
                                  style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#1e293b', width: '26px', height: '26px', borderRadius: '6px', cursor: imgIdx === item.imageUrls.length - 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, opacity: imgIdx === item.imageUrls.length - 1 ? 0.4 : 1 }}
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Contract Document Upload */}
                    <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', background: '#fafbfc', padding: '1rem 1.25rem', marginTop: '1.25rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                        <FileText size={16} color="#1d4ed8" /> Contract Document (PDF, Word, Excel)
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>
                        Attach the signed contract so rates can be verified against it. Click the contract in the directory to read it.
                      </span>

                      {!dbFeatures.contracts && (
                        <div style={{ background: '#fefce8', border: '1px solid #facc15', borderRadius: '6px', padding: '0.5rem 0.75rem', marginTop: '0.6rem', fontSize: '0.74rem', fontWeight: 600, color: '#854d0e' }}>
                          Contract attachment will be saved after the database migration is applied
                          (20260829_contract_documents.sql).
                        </div>
                      )}

                      <input
                        type="file"
                        id={`contract-input-${item.tempId}`}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          handleContractFileSelect(item.tempId, e.target.files);
                          e.target.value = '';
                        }}
                      />

                      {uploadingContract === item.tempId ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.85rem', color: '#475569' }}>
                          <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Uploading contract…
                        </div>
                      ) : item.contractUrl ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.75rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '0.45rem 0.75rem', width: 'fit-content' }}>
                          <FileText size={15} color="#1d4ed8" />
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e3a8a', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.contractName}
                          </span>
                          <button type="button" onClick={() => handleRemoveContract(item.tempId)} title="Remove contract" style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => document.getElementById(`contract-input-${item.tempId}`)?.click()}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#1e293b', padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.75rem', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                        >
                          <UploadCloud size={16} /> Choose contract file
                        </button>
                      )}
                    </div>
                  </div>

                </div>
                );
              })}

              {/* Centered Add Another Item Button */}
              {addMultiple && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                  <button 
                    type="button" 
                    onClick={handleAddAnotherItem}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#1e293b',
                      padding: '0.55rem 1.25rem',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                    }}
                  >
                    <Plus size={16} /> Add Another Library Item
                  </button>
                </div>
              )}

              {/* Bottom Right Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                <button 
                  type="button" 
                  onClick={() => { setShowInlineForm(false); setEditingItems({}); }}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    color: '#1e293b',
                    padding: '0.6rem 1.4rem',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={saving}
                  style={{
                    background: '#00665c',
                    border: 'none',
                    color: '#ffffff',
                    padding: '0.6rem 1.6rem',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,102,92,0.15)'
                  }}
                >
                  {saving ? 'Saving...' : (Object.keys(editingItems).length > 0 ? 'Save Changes' : 'Add Library Item(s)')}
                </button>
              </div>

            </div>

          </form>

        </div>
      )}

      {/* MASTER LIST OF CREATED LIBRARY ITEMS */}
      <div className="admin-table-container">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Library Items Directory ({filteredList.length})
          </h3>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Library Item & Images</th>
              <th>Contract</th>
              <th>Supplier</th>
              <th>Category</th>
              <th>Meal Plan</th>
              <th>Max Occ</th>
              <th>Seasonal Rates Matrix</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" className="text-center" style={{ padding: '3rem' }}>Loading library items...</td></tr>
            ) : filteredList.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Package size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3>No Library Items Found</h3>
                  <p>Click "+ Add Library Item" above to build your item catalog.</p>
                </td>
              </tr>
            ) : filteredList.map((item) => {
              const catObj = categories.find(c => c.id === item.category);
              const IconComp = catObj?.icon || Package;
              const hasImages = item.images && item.images.length > 0;
              const isTourStyle = isTourStyleCategory(item.category);
              const transType = item.category === 'Transfers' ? transferTypes.find(t => t.id === item.transfer_type) : null;

              return (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {hasImages ? (
                        <img 
                          src={item.images[0]} 
                          alt={item.name} 
                          onClick={() => setLightbox({ images: item.images, index: 0 })}
                          title={`View ${item.images.length} image${item.images.length > 1 ? 's' : ''}`}
                          style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #e2e8f0', cursor: 'pointer' }} 
                        />
                      ) : (
                        <div style={{ background: '#f1f5f9', color: catObj?.color || '#334155', width: '48px', height: '48px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <IconComp size={22} />
                        </div>
                      )}
                      <div>
                        <span style={{ fontWeight: 700, color: '#0f172a', display: 'block' }}>{item.name}</span>
                        {isTourStyle && item.sub_category && item.sub_category !== 'Transfers' && (
                          <span style={{ display: 'inline-block', marginTop: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            🚐 {item.sub_category} · {item.max_occupancy || 4} pax
                          </span>
                        )}
                        {transType && (
                          <span style={{ display: 'inline-block', marginLeft: '0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.1rem 0.45rem' }}>
                            {transType.icon} {transType.label}
                          </span>
                        )}
                        {item.description && (
                          <span 
                            onClick={() => setDescriptionPopup(item.description)}
                            title="Click to view full description"
                            style={{ fontSize: '0.8rem', color: '#64748b', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '3px' }}
                          >
                            {item.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {item.contract_url ? (
                      <button
                        type="button"
                        onClick={() => setContractPopup({ name: item.contract_name || 'Contract Document', url: item.contract_url })}
                        title="Click to read the contract document"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '0.35rem 0.7rem', cursor: 'pointer' }}
                      >
                        <FileText size={14} /> View Contract
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
                      {item.supplier?.name || 'Unassigned'}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge active" style={{ background: '#f8fafc', color: catObj?.color || '#334155', border: '1px solid #e2e8f0' }}>
                      {item.category}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                      <div className="meal-plan-cell">{item.item_rates?.find(r => r.meal_plan)?.meal_plan || '—'}</div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                      <div>Max Occ: <strong>{item.max_occupancy || 2} Persons</strong></div>
                      {item.category === 'Accommodation' && Array.isArray(item.sharing_capacity_rules) && item.sharing_capacity_rules.length > 0 ? (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem', lineHeight: '1.35' }}>
                          {item.sharing_capacity_rules.map(r => `${r.adults}A (+${r.maxChildren}Ch)`).join(' · ')}
                        </div>
                      ) : item.category === 'Accommodation' ? (
                        <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.2rem' }}>
                          Max {item.max_adults || item.max_occupancy || 2} Adults
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {/* Pricing model badge */}
                      {item.fee_type === 'entrance' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#0f766e', background: '#f0fdf4', border: '1px solid #99f6e4', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🎟️ Entrance Fees
                        </span>
                      )}
                      {item.fee_type === 'conservation' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#0f766e', background: '#f0fdf4', border: '1px solid #99f6e4', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🌿 Conservation Levy {item.conservation_levy_basis === 'per_stay' ? '(Per Stay)' : '(Per Night)'}
                        </span>
                      )}
                      {isTourStyle && item.pricing_model === 'per_vehicle' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🚐 Flat Rate (Per Vehicle)
                        </span>
                      ) : isTourStyle && item.pricing_model === 'tiered' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          📊 Tiered (by pax count)
                        </span>
                      ) : isTourStyle ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#047857', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          👤 Per Person
                        </span>
                      ) : item.pricing_model === 'per_room' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          🏠 Flat Room Rate
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#047857', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '5px', padding: '0.15rem 0.45rem', marginBottom: '0.2rem', width: 'fit-content' }}>
                          👥 Per Person (PPS)
                        </span>
                      )}
                      {item.item_rates && item.item_rates.length > 0 ? (
                        item.item_rates.map((rate, rIdx) => {
                          const isFlat = item.pricing_model === 'per_room' || rate.rate_basis === 'per_room';
                          const flatRate = parseFloat(rate.unit_price) || parseFloat(rate.price_1_adult) || 0;
                          const p1 = parseFloat(rate.price_1_adult || rate.single_room_rate) || 0;
                          const p2 = parseFloat(rate.price_2_adults || rate.double_twin_rate) || 0;
                          const p3 = parseFloat(rate.price_3_plus_adults) || 0;
                          const childRatesMap = rate.child_rates_breakdown || {};
                          const childBands = item.child_age_ranges || [];
                          const hasBreakdown = Object.keys(childRatesMap).length > 0 && childBands.length > 0;
                          const guideDriverOffered = item.guide_driver_room_offered === true;
                          const singleRate = isFlat ? flatRate : (p1 || 0);
                          const guideRate = parseFloat(rate.guide_rate) || 0;
                          const driverRate = parseFloat(rate.driver_rate) || 0;
                          const guideEff = guideDriverOffered && guideRate > 0 ? guideRate : singleRate;
                          const driverEff = guideDriverOffered && driverRate > 0 ? driverRate : singleRate;
                          const itemMealPlan = item.item_rates?.find(r => r.meal_plan)?.meal_plan || '—';
                          const guideMealPlan = rate.guide_meal_plan || itemMealPlan;
                          const driverMealPlan = rate.driver_meal_plan || itemMealPlan;
                          const transferTiers = Array.isArray(rate.tiered_pricing) ? rate.tiered_pricing : [];
                          const transferTierRate = parseFloat(rate.tiered_pricing?.[0]?.rate) || 0;
                          const transferAdultRate = parseFloat(rate.price_1_adult || rate.unit_price) || transferTierRate;
                          const transferChildRate = parseFloat(childRatesMap.child) || 0;

                          return (
                            <div key={rIdx} style={{ fontSize: '0.78rem', background: '#f8fafc', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #e2e8f0', lineHeight: 1.4 }}>
                              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.15rem' }}>
                                {rate.season_name || 'Season'}:
                              </div>
                              {isTourStyle ? (
                                <>
                                  {item.pricing_model === 'per_vehicle' || rate.rate_basis === 'per_vehicle' ? (
                                    <div style={{ color: '#1d4ed8', fontWeight: 600 }}>
                                      {item.currency} {transferAdultRate.toLocaleString()} / vehicle
                                      <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                                        (÷ pax for per-person rate)
                                      </span>
                                    </div>
                                  ) : item.pricing_model === 'tiered' || rate.rate_basis === 'tiered' ? (
                                    (transferTiers.length > 0 ? (
                                      <div style={{ color: '#7c3aed' }}>
                                        {transferTiers.map((t, tIdx) => (
                                          <div key={tIdx} style={{ fontWeight: 600 }}>
                                            {t.min_pax}–{t.max_pax} pax: {item.currency} {(parseFloat(t.rate) || 0).toLocaleString()}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ color: '#7c3aed', fontWeight: 600 }}>
                                        {item.currency} {transferAdultRate.toLocaleString()} (tiered)
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ color: '#334155' }}>
                                      <strong>Per Person:</strong> {item.currency} {transferAdultRate.toLocaleString()}
                                    </div>
                                  )}
                                  {transferChildRate > 0 && (
                                    <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                      Child (up to {parseInt(childBands[0]?.ageTo) || 12} yrs): {item.currency} {transferChildRate.toLocaleString()}
                                    </div>
                                  )}
                                </>
                              ) : isFlat ? (
                                <div style={{ color: '#7c3aed', fontWeight: 600 }}>
                                  Flat Rate: {item.currency} {flatRate.toLocaleString()} / room
                                  <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                                    (÷ occupants for per-person rate)
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <div style={{ color: '#334155' }}>
                                    <strong>Single:</strong> {item.currency} {p1.toLocaleString()} | <strong>PPS:</strong> {item.currency} {p2.toLocaleString()}
                                  </div>
                                  {p3 > 0 && (
                                    <div style={{ color: '#475569', fontSize: '0.74rem' }}>
                                      <strong>3+ Adults:</strong> {item.currency} {p3.toLocaleString()} (PP)
                                    </div>
                                  )}
                                  {hasBreakdown && (
                                    <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                      Child Sharing: {childBands.map(b => `${b.name}: ${item.currency} ${(parseFloat(childRatesMap[b.id]) || 0).toLocaleString()}`).join(' | ')}
                                    </div>
                                  )}
                                </>
                              )}
                              {item.category === 'Accommodation' && (
                                <div style={{ color: '#b45309', fontSize: '0.7rem', marginTop: '0.15rem', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.2rem 0.4rem', borderRadius: '4px', display: 'flex', flexWrap: 'wrap', gap: '0 0.5rem' }}>
                                  {guideDriverOffered ? (
                                    <span>
                                      Guide: {item.currency} {guideEff.toLocaleString()} ({guideMealPlan}) | Driver: {item.currency} {driverEff.toLocaleString()} ({driverMealPlan})
                                    </span>
                                  ) : (
                                    <span>
                                      Guide/Driver: defaults to Single ({item.currency} {singleRate.toLocaleString()})
                                    </span>
                                  )}
                                </div>
                              )}
                              {item.fee_type === 'entrance' && ((parseFloat(rate.entrance_fee_per_person) || 0) > 0 || (parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0) && (
                                <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.15rem' }}>
                                  {(parseFloat(rate.entrance_fee_per_person) || 0) > 0 && (
                                    <span><strong>Entrance / Person:</strong> {item.currency} {(parseFloat(rate.entrance_fee_per_person) || 0).toLocaleString()}</span>
                                  )}
                                  {(parseFloat(rate.entrance_fee_per_person) || 0) > 0 && (parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0 && <span style={{ margin: '0 0.3rem' }}>|</span>}
                                  {(parseFloat(rate.entrance_fee_per_vehicle) || 0) > 0 && (
                                    <span><strong>Entrance / Vehicle:</strong> {item.currency} {(parseFloat(rate.entrance_fee_per_vehicle) || 0).toLocaleString()}</span>
                                  )}
                                </div>
                              )}
                              {item.fee_type === 'conservation' && ((parseFloat(rate.conservation_levy_per_adult) || 0) > 0 || (parseFloat(rate.conservation_levy_per_child) || 0) > 0) && (
                                <div style={{ color: '#0f766e', fontWeight: 600, marginTop: '0.15rem' }}>
                                  {(parseFloat(rate.conservation_levy_per_adult) || 0) > 0 && (
                                    <span><strong>Levy Adult{item.conservation_levy_basis === 'per_stay' ? ' / Stay' : ' / Night'}:</strong> {item.currency} {(parseFloat(rate.conservation_levy_per_adult) || 0).toLocaleString()}</span>
                                  )}
                                  {(parseFloat(rate.conservation_levy_per_adult) || 0) > 0 && (parseFloat(rate.conservation_levy_per_child) || 0) > 0 && <span style={{ margin: '0 0.3rem' }}>|</span>}
                                  {(parseFloat(rate.conservation_levy_per_child) || 0) > 0 && (
                                    <span><strong>Levy Child{item.conservation_levy_basis === 'per_stay' ? ' / Stay' : ' / Night'}:</strong> {item.currency} {(parseFloat(rate.conservation_levy_per_child) || 0).toLocaleString()}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No rates defined</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn" onClick={() => handleEditItem(item)} title="Edit Item">
                        <Edit3 size={16} />
                      </button>
                      <button className="action-btn delete" onClick={() => handleDeleteItem(item.id)} title="Delete Item">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* IMAGE GALLERY LIGHTBOX */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.9)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            title="Close"
            style={{ position: 'absolute', top: '1rem', right: '1.25rem', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '40px', height: '40px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={24} />
          </button>

          <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Image {lightbox.index + 1} of {lightbox.images.length}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(prev => prev && { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length })}
              title="Previous image"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ChevronLeft size={26} />
            </button>
            <img
              src={lightbox.images[lightbox.index]}
              alt={`Image ${lightbox.index + 1}`}
              style={{ maxWidth: '75vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: '8px', background: '#000' }}
            />
            <button
              onClick={() => setLightbox(prev => prev && { ...prev, index: (prev.index + 1) % prev.images.length })}
              title="Next image"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ChevronRight size={26} />
            </button>
          </div>

          {lightbox.images.length > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '80vw' }} onClick={(e) => e.stopPropagation()}>
              {lightbox.images.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt={`Thumb ${i + 1}`}
                  onClick={() => setLightbox(prev => prev && { ...prev, index: i })}
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '6px',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    border: i === lightbox.index ? '2px solid #14b8a6' : '2px solid rgba(255,255,255,0.25)',
                    opacity: i === lightbox.index ? 1 : 0.65
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* DESCRIPTION POPUP */}
      {descriptionPopup && (
        <div
          onClick={() => setDescriptionPopup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', padding: '1.75rem', maxWidth: '560px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="#00665c" /> Item Description
              </h3>
              <button onClick={() => setDescriptionPopup(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6, color: '#334155', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {descriptionPopup}
            </p>
          </div>
        </div>
      )}

      {/* CONTRACT DOCUMENT POPUP */}
      {contractPopup && (
        <div
          onClick={() => setContractPopup(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.7)',
            zIndex: 1002,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', width: 'min(1100px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <FileText size={18} color="#1d4ed8" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {contractPopup.name}
                </span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                <a
                  href={contractPopup.url}
                  target="_blank"
                  rel="noreferrer"
                  download={contractPopup.name}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#00665c', color: '#fff', border: 'none', padding: '0.45rem 1rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}
                >
                  <Download size={15} /> Download
                </a>
                <button onClick={() => setContractPopup(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <iframe
              src={getContractViewerSrc(contractPopup.url, contractPopup.name)}
              title="Contract Document"
              style={{ width: '100%', height: '72vh', minHeight: '420px', border: 'none', background: '#f1f5f9' }}
            />

            <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid #e2e8f0', background: '#fafafa', fontSize: '0.78rem', color: '#64748b' }}>
              If the preview does not load, use <strong>Download</strong> to open the document directly.
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
