import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { arSA } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowUpLeft, BadgeCheck, MapPin, Box, Check, Clock3, Filter, Leaf, LoaderCircle, Menu, PackageCheck, PackagePlus, Search, ShieldCheck, ShoppingBag, ShoppingCart, Store, Truck, UserRound, X, Wallet, RotateCcw, LayoutDashboard, Users, ReceiptText, Settings2 } from 'lucide-react';
import {
  getGetAdminSummaryQueryKey, getGetProductQueryKey, getGetSellerProfileQueryKey, getListAdminOrdersQueryKey, getListAdminSellersQueryKey,
  getListProductsQueryKey, getListSellerOrdersQueryKey, getListSellerProductsQueryKey, useApplyAsSeller,
  useCreateSellerProduct, useDeleteSellerProduct, useDecideSellerApplication, useGetAdminSummary, useGetProduct,
  useGetSellerProfile, useListAdminOrders, useListAdminSellers, useListProducts, useListSellerOrders, useListSellerProducts,
  useUpdateOrderStatus, useUpdateSellerProduct, type Order, type OrderStatus, type Product, type Seller,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const money = (value: number) => `${new Intl.NumberFormat('ar-SD').format(value)} ج.س.`;
const statuses: Record<string, string> = { new: 'جديد', preparing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التوصيل', cancelled: 'ملغي', pending: 'قيد المراجعة', approved: 'مقبول', rejected: 'غير مقبول' };
const productCategories = ['ملابس', 'أحذية', 'عطور', 'أغذية ومشروبات', 'إلكترونيات', 'المنزل', 'العناية الشخصية', 'إكسسوارات', 'أخرى'];
const categories = ['الكل', ...productCategories];
const sudanCities = ['الخرطوم', 'الخرطوم بحري', 'أم درمان'];
const productTints = ['#dbe6d7', '#f2ddd0', '#e7dfc8', '#d8e6e2', '#ece0d9', '#e3e7d1'];
type CartRow = { product: Product; quantity: number };

function useCart() {
  const [items, setItems] = useState<CartRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('geebli-cart') || '[]') as CartRow[]; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('geebli-cart', JSON.stringify(items)); }, [items]);
  const add = (product: Product) => setItems((old) => {
    if (product.stock < 1) return old;
    const found = old.find((r) => r.product.id === product.id);
    if (found && found.quantity >= product.stock) return old;
    return found ? old.map((r) => r.product.id === product.id ? { ...r, quantity: r.quantity + 1 } : r) : [...old, { product, quantity: 1 }];
  });
  const setQty = (id: number, quantity: number) => setItems((old) => old.map((r) => {
    if (r.product.id !== id) return r;
    return { ...r, quantity: Math.min(quantity, r.product.stock) };
  }).filter((r) => r.quantity > 0));
  return { items, add, setQty, clear: () => setItems([]), count: items.reduce((n, r) => n + r.quantity, 0), total: items.reduce((n, r) => n + r.product.price * r.quantity, 0) };
}

function Header({ cartCount = 0 }: { cartCount?: number }) {
  const [open, setOpen] = useState(false);
  return <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
    <div className="shell flex h-[76px] items-center justify-between gap-5">
      <Link href="/" className="flex items-center gap-2 no-underline text-inherit" data-testid="link-home">
        <img src="/logo.svg" alt="GEEBLI جيب لي" className="h-12 w-auto object-contain" />
      </Link>
      <nav className={`${open ? 'flex' : 'hidden'} absolute inset-x-0 top-[76px] flex-col gap-4 border-b bg-[hsl(var(--background))] px-6 py-5 md:static md:flex md:flex-row md:items-center md:border-0 md:bg-transparent md:p-0`}>
        <Link href="/shop" className="text-sm font-semibold text-inherit no-underline">تصفّح المتجر</Link>
        <Link href="/my-orders" className="text-sm font-semibold text-inherit no-underline">طلباتي</Link>
        <a href="/#why" className="text-sm text-[hsl(var(--muted-foreground))] no-underline">عن جيبلي</a>
        <Link href="/seller" className="text-sm text-[hsl(var(--muted-foreground))] no-underline">كن بائعاً</Link>
        <Link href="/contact" className="text-sm text-[hsl(var(--muted-foreground))] no-underline">تواصل معنا</Link>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-inherit no-underline sm:block">دخول</Link>
        <Link href="/checkout" className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--border))] text-inherit" aria-label="السلة" data-testid="link-cart"><ShoppingCart size={18}/>{cartCount > 0 && <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--accent))] px-1 text-[10px] font-bold">{cartCount}</span>}</Link>
        <button className="flex h-10 w-10 items-center justify-center rounded-full md:hidden" onClick={() => setOpen(!open)} aria-label="القائمة" data-testid="button-menu">{open ? <X size={20}/> : <Menu size={20}/>}</button>
      </div>
    </div>
  </header>;
}

function Footer() {
  return <footer className="mt-24 bg-[#17483e] py-12 text-[#f6f0e4]"><div className="shell grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
    <div><div className="serif text-3xl font-extrabold">GEEBLI<span className="text-[#f07816]">.</span></div><p className="mt-3 max-w-md text-sm leading-7 text-[#d1ddd3]">تسوّق من صُنّاع مستقلين تثق بهم. اختيارات محلية، وقصص تستحق أن تُروى.</p></div>
    <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm"><Link className="text-inherit no-underline" href="/shop">تصفّح المتجر</Link><Link className="text-inherit no-underline" href="/seller">ابدأ متجرك</Link><Link className="text-inherit no-underline" href="/sign-in">حسابي</Link><Link className="text-inherit no-underline" href="/contact">تواصل مع الإدارة</Link></div>
    <p className="m-0 text-xs text-[#aebfb2] md:col-span-2">© ٢٠٢٥ جيبلي — سوق محلي يجمعنا.</p>
  </div></footer>;
}

function ProductArt({ product, index = 0, large = false }: { product: Product; index?: number; large?: boolean }) {
  const tint = productTints[index % productTints.length];
  const glyphs = [<Box key="box" size={large ? 84 : 58} strokeWidth={1.1}/>, <Leaf key="leaf" size={large ? 84 : 58} strokeWidth={1.1}/>, <PackageCheck key="pack" size={large ? 84 : 58} strokeWidth={1.1}/>];
  return <div className="product-art" style={{ backgroundColor: tint, color: '#27594c', minHeight: large ? 450 : undefined }}><span className="absolute left-5 top-5 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-[#31564c]">صنع محلياً</span>{product.imageUrl ? <img src={product.imageUrl} alt={product.title} className="relative z-[1] h-full max-h-[390px] w-full object-cover"/> : <div className="relative z-[1] flex flex-col items-center gap-4"><span className="flex h-28 w-28 items-center justify-center rounded-full bg-white/55">{glyphs[index % glyphs.length]}</span><span className="text-sm font-semibold">{product.category}</span></div>}</div>;
}

function ProductCard({ product, index = 0, onAdd }: { product: Product; index?: number; onAdd: (p: Product) => void }) {
  return <article className="group overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition-transform duration-300 hover:-translate-y-1" data-testid={`card-product-${product.id}`}>
    <Link href={`/product/${product.id}`} className="block text-inherit no-underline"><ProductArt product={product} index={index}/></Link>
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-[hsl(var(--muted-foreground))]">{product.sellerName}</span><span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px]">{product.category}</span></div>
      <div className="mb-2"><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${product.stock > 0 ? 'bg-[#e0f1e3] text-[#23743a]' : 'bg-[#f9e1df] text-[#b3261e]'}`}>{product.stock > 0 ? '● متاح' : 'غير متاح'}</span></div>
      <Link href={`/product/${product.id}`} className="line-clamp-1 text-base font-bold text-inherit no-underline" data-testid={`link-product-${product.id}`}>{product.title}</Link>
      <div className="mt-4 flex items-center justify-between"><span className="text-[15px] font-bold">{money(product.price)}</span><button className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40" disabled={product.stock < 1} onClick={() => onAdd(product)} aria-label={product.stock > 0 ? 'أضف إلى السلة' : 'المنتج غير متاح'} data-testid={`button-add-${product.id}`}><ShoppingCart size={16}/></button></div>
    </div>
  </article>;
}

function LoadingGrid() { return <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="overflow-hidden rounded-[20px] border bg-card"><div className="h-48 animate-pulse bg-muted"/><div className="space-y-3 p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-muted"/><div className="h-4 animate-pulse rounded bg-muted"/><div className="h-4 w-1/2 animate-pulse rounded bg-muted"/></div></div>)}</div>; }

function Home({ cart }: { cart: ReturnType<typeof useCart> }) {
  return <><Header cartCount={cart.count}/><main className="grain">
    <section className="hero-surface overflow-hidden">
      <div className="shell grid min-h-[620px] items-center gap-10 py-10 md:min-h-[650px] md:grid-cols-[1fr_.95fr] md:gap-12 md:py-16">
        <div className="fade-up order-1 max-w-[620px] text-right">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#bdcabb] bg-white/65 px-4 py-2.5 text-xs font-bold text-[#31574b] shadow-sm"><span className="h-2 w-2 rounded-full bg-[#ed9d70]"/> سوق يجمع الحكايات المحلية</span>
          <h1 className="serif mb-5 text-[clamp(42px,7vw,82px)] font-extrabold leading-[1.12] tracking-[-2px] text-[#173f37]">أشياء جميلة،<br/><span className="text-[#d9875f]">من ناس حقيقيين.</span></h1>
          <p className="mb-8 max-w-[510px] text-[17px] leading-8 text-[#46665c]">اكتشف منتجات مختارة من متاجر سودانية مستقلة. تسوّق كضيف، ببساطة واطمئنان.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/shop" className="btn btn-primary inline-flex items-center gap-2 !px-7 !py-3.5 shadow-[0_12px_26px_rgba(23,72,62,.18)]" data-testid="link-shop-hero">تصفّح المنتجات <ArrowUpLeft size={18}/></Link>
            <Link href="/seller" className="btn btn-outline inline-flex !px-6 !py-3.5" data-testid="link-seller-hero">ابدأ متجرك</Link>
          </div>
          <p className="mt-5 text-xs font-medium text-[#658075]">منتجات مختارة · بائعون موثوقون · الدفع عند الاستلام</p>
        </div>
        <div className="hero-brand-visual order-2 relative mx-auto flex min-h-[330px] w-full max-w-[490px] items-center justify-center md:min-h-[470px]">
          <div className="hero-orbit hero-orbit-one"/>
          <div className="hero-orbit hero-orbit-two"/>
          <div className="hero-brand-glow"/>
          <div className="hero-brand-card relative z-[2] flex w-[min(88%,390px)] flex-col items-center justify-center rounded-[34px] border border-white/80 bg-white/75 px-7 py-10 shadow-[0_28px_70px_rgba(40,78,58,.16)] backdrop-blur-xl">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#e8f0e5] px-4 py-2 text-xs font-bold text-[#315b48]"><BadgeCheck size={16}/> اختيارات موثوقة</span>
            <div className="hero-logo-halo flex h-36 w-36 items-center justify-center rounded-full border border-white/80 bg-gradient-to-br from-[#fff9ec] to-[#dcebdc] shadow-inner">
              <img src="/logo.svg" alt="شعار جيب لي" className="h-auto w-[118px] object-contain"/>
            </div>
            <p className="mt-6 text-center text-lg font-extrabold text-[#17483e]">كل حكاية تبدأ من هنا</p>
            <p className="mt-2 text-center text-sm leading-6 text-[#668075]">منتجات محلية من ناس حقيقيين</p>
          </div>
          <div className="absolute bottom-5 left-1 z-[3] rounded-2xl border border-[#e4e8dc] bg-[#fffdf6] px-4 py-3 shadow-lg sm:left-3"><div className="text-[11px] text-[#758376]">تسوّق براحتك</div><div className="mt-1 text-sm font-bold text-[#31574b]">ببساطة واطمئنان</div></div>
        </div>
      </div>
    </section>
    <section id="why" className="shell py-14 md:py-20"><div className="grid gap-7 rounded-[30px] border border-[#e0e4d8] bg-[#f0eee4] p-6 shadow-[0_18px_50px_rgba(44,73,54,.06)] md:grid-cols-[.85fr_1fr] md:items-center md:p-12"><div><p className="text-xs font-bold tracking-widest text-[#ae6e4d]">تسوّق بقلب مرتاح</p><h2 className="serif mb-3 mt-2 text-3xl font-extrabold text-[#173f37]">محلي، قريب، وواضح.</h2><p className="m-0 max-w-md text-sm leading-7 text-[#5c6c61]">نراجع المتاجر قبل انضمامها، ونجعل الطلب سهلاً دون إنشاء حساب. أنت تختار، والبائع يتولى الباقي.</p></div><div className="grid gap-3 sm:grid-cols-3"><Benefit icon={<ShieldCheck/>} title="متاجر مراجعة" text="بائعون مستقلون موثوقون"/><Benefit icon={<Truck/>} title="طلب مباشر" text="توصيل لباب بيتك"/><Benefit icon={<UserRound/>} title="بدون حساب" text="أكمل الشراء كضيف"/></div></div></section>
  </main><Footer/></>;
}
function ShopPage({ cart }: { cart: ReturnType<typeof useCart> }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('الكل');
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ ...(search ? { q: search } : {}), ...(category !== 'الكل' ? { category } : {}), limit: 60 }), [search, category]);
  const productsQuery = useListProducts(params);
  const products = productsQuery.data ?? [];
  const submitSearch = (e: FormEvent) => { e.preventDefault(); setSearch(query.trim()); };
  return <><Header cartCount={cart.count}/><main className="grain">
    <section className="shell py-12 md:py-16" id="catalog">
      <div className="mb-7"><p className="mb-2 text-xs font-bold tracking-[.18em] text-[#b56f4e]">السوق اليوم</p><h1 className="serif m-0 text-3xl font-extrabold md:text-4xl">{search ? `نتائج «${search}»` : 'اكتشف منتجات جيبلي'}</h1><p className="mb-0 mt-2 text-sm text-muted-foreground">منتجات من متاجر محلية مستقلة.</p></div>
      <form onSubmit={submitSearch} className="mb-7 flex max-w-[620px] items-center gap-2 rounded-full border border-[#d4dbcf] bg-card p-2">
        <Search className="mr-3 text-[#668075]" size={20}/><input aria-label="ابحث عن منتج" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="ما الذي تبحث عنه؟" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="input-search"/>
        <button className="btn btn-primary !px-5 !py-2.5" type="submit" data-testid="button-search">ابحث</button>
      </form>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Filter size={16}/> تصفّح حسب الفئة</div><span className="text-xs text-muted-foreground">{products.length} منتج</span></div>
      <div className="mb-7 flex gap-2 overflow-x-auto pb-2">{categories.map((item) => <button key={item} className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold transition ${category === item ? 'bg-[#17483e] text-[#fff9ed]' : 'bg-[#eae8df] text-[#52665c] hover:bg-[#dde4d8]'}`} onClick={() => setCategory(item)} data-testid={`filter-${item}`}>{item}</button>)}</div>
      {productsQuery.isLoading ? <LoadingGrid/> : productsQuery.isError ? <div className="rounded-2xl border border-dashed p-12 text-center"><p className="font-bold">تعذّر تحميل المنتجات</p><p className="text-sm text-muted-foreground">تحقق من اتصالك ثم حاول من جديد.</p><button className="btn btn-primary mt-3" onClick={() => productsQuery.refetch()}>إعادة المحاولة</button></div> : products.length ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{products.map((p, i) => <ProductCard key={p.id} product={p} index={i} onAdd={cart.add}/>)}</div> : <div className="rounded-[24px] border border-dashed border-[#c7d2c5] bg-[#f2f1e9] px-6 py-14 text-center"><Search className="mx-auto mb-3 text-[#7d9588]"/><h3 className="m-0 text-lg font-bold">لا توجد منتجات هنا بعد</h3><p className="mb-0 mt-2 text-sm text-muted-foreground">جرّب فئة أخرى أو غيّر كلمات البحث.</p></div>}
    </section>
  </main><Footer/></>;
}

function ContactPage() {
  const contacts: Array<{ label: string; number: string; link: string }> = [];
  return <><Header/><main className="grain min-h-[70vh]"><section className="hero-surface"><div className="shell py-12 md:py-16"><div className="mx-auto max-w-[760px] text-center"><img src="/logo.svg" alt="GEEBLI جيب لي" className="mx-auto mb-5 h-16 w-auto" /><p className="text-xs font-bold tracking-widest text-[#b56f4e]">نحن هنا للمساعدة</p><h1 className="serif mt-2 text-3xl font-extrabold text-[#173f37] md:text-4xl">تواصل مع إدارة جيب لي</h1><p className="mx-auto mt-3 max-w-xl leading-8 text-[#526b5e]">للاستفسارات أو الشكاوى أو المساعدة، اختر وسيلة التواصل المناسبة وسنكون سعداء باستقبال رسالتك.</p></div></div></section><section className="shell -mt-5 grid max-w-[900px] gap-4 pb-16 sm:grid-cols-2">{contacts.map((contact) => <a key={contact.number} href={contact.link} target="_blank" rel="noreferrer" className="rounded-[24px] border border-[#dce2d6] bg-[#fffdf7] p-6 text-center text-inherit no-underline shadow-[0_14px_40px_rgba(35,73,53,.07)] transition hover:-translate-y-1 hover:border-[#e89a61]"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e4eee1] text-[#205b3d]"><ShoppingBag size={22}/></div><div className="mt-4 text-sm font-semibold text-[#64756a]">{contact.label}</div><div dir="ltr" className="mt-3 text-lg font-extrabold text-[#17483e]">{contact.number}</div><div className="mt-5 inline-flex rounded-full bg-[#17483e] px-5 py-2.5 text-sm font-semibold text-white">راسلنا على واتساب</div></a>)}<a href="mailto:geebli.market@gmail.com" className="rounded-[24px] border border-[#dce2d6] bg-[#fffdf7] p-6 text-center text-inherit no-underline shadow-[0_14px_40px_rgba(35,73,53,.07)] transition hover:-translate-y-1 hover:border-[#e89a61]"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0df] text-[#d97732]"><span className="text-xl font-bold">@</span></div><div className="mt-4 text-sm font-semibold text-[#64756a]">البريد الإلكتروني الرسمي</div><div dir="ltr" className="mt-3 break-all text-base font-extrabold text-[#17483e]">geebli.market@gmail.com</div><div className="mt-5 inline-flex rounded-full bg-[#e9e6d9] px-5 py-2.5 text-sm font-semibold text-[#17483e]">أرسل بريداً إلكترونياً</div></a></section></main><Footer/></>;
}

function Benefit({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="rounded-2xl bg-[#f8f5eb] p-4"><div className="mb-4 text-[#2f6958]">{icon}</div><div className="text-sm font-bold">{title}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{text}</div></div>; }

function ProductPage({ cart }: { cart: ReturnType<typeof useCart> }) {
  const [, params] = useRoute('/product/:id');
  const id = Number(params?.id || 0);
  const query = useGetProduct(id, { query: { enabled: id > 0, queryKey: getGetProductQueryKey(id) } });
  const product = query.data;
  if (query.isLoading) return <><Header cartCount={cart.count}/><div className="shell py-14"><div className="grid animate-pulse gap-10 md:grid-cols-2"><div className="h-[430px] rounded-3xl bg-muted"/><div className="h-80 rounded-3xl bg-muted"/></div></div></>;
  if (!product) return <><Header cartCount={cart.count}/><div className="shell py-24 text-center"><h1>لم نعثر على هذا المنتج</h1><Link href="/shop" className="btn btn-primary mt-4">العودة للمتجر</Link></div></>;
  return <><Header cartCount={cart.count}/><main className="shell py-8 md:py-14"><Link href="/shop" className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground no-underline"><ArrowLeft size={16}/> العودة للتسوّق</Link><div className="grid gap-8 md:grid-cols-[1.1fr_.9fr] md:gap-14"><div className="overflow-hidden rounded-[28px]"><ProductArt product={product} large/></div><div className="self-center"><span className="rounded-full bg-[#e3eadf] px-3 py-1.5 text-xs font-semibold text-[#356252]">{product.category}</span><span className={`mr-2 inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${product.stock > 0 ? 'bg-[#e0f1e3] text-[#23743a]' : 'bg-[#f9e1df] text-[#b3261e]'}`}>{product.stock > 0 ? '● متاح' : 'غير متاح'}</span><h1 className="serif mb-3 mt-5 text-4xl font-extrabold leading-tight">{product.title}</h1><p className="text-sm text-muted-foreground">من متجر {product.sellerName}</p><p className="mt-8 text-2xl font-bold">{money(product.price)}</p><div className="my-7 h-px bg-border"/><p className="whitespace-pre-line text-[15px] leading-8 text-[#596b60]">{product.description}</p><div className="mt-6 flex items-center gap-2 text-sm text-[#527264]"><ShieldCheck size={18}/> بائع موثوق عبر جيبلي</div><button className="btn btn-primary mt-8 w-full py-4 md:w-auto md:px-10 disabled:cursor-not-allowed disabled:opacity-50" disabled={product.stock < 1} onClick={() => cart.add(product)} data-testid="button-add-cart">{product.stock > 0 ? <><ShoppingCart size={18}/> أضف إلى السلة</> : 'غير متاح حالياً'}</button><div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Truck size={16}/> الدفع عند الاستلام متاح</div></div></div></main><Footer/></>;
}

function Checkout({ cart }: { cart: ReturnType<typeof useCart> }) {
  const [, setLocation] = useLocation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ buyerName: '', phone: '', city: '', address: '' });
  const [pin, setPin] = useState('');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const locateMe = () => {
    if (!navigator.geolocation) { setLocationMessage('المتصفح لا يدعم تحديد الموقع.'); return; }
    setLocating(true);
    setLocationMessage('جارٍ تحديد موقعك… وافق على طلب الإذن من الهاتف.');
    const savePosition = (position: GeolocationPosition) => {
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationMessage('تم تحديد موقعك وإضافته للطلب.');
      setLocating(false);
    };
    const showLocationError = (geoError: GeolocationPositionError) => {
      setLocationMessage(geoError.code === geoError.PERMISSION_DENIED
        ? 'لم تسمح بالوصول للموقع. يمكنك إكمال الطلب بالعنوان المكتوب.'
        : geoError.code === geoError.POSITION_UNAVAILABLE
          ? 'إشارة الموقع غير متاحة حالياً. تأكد من تشغيل GPS وحاول في مكان مفتوح.'
          : 'استغرق تحديد الموقع وقتاً طويلاً. حاول مرة أخرى أو أكمل الطلب بالعنوان المكتوب.');
      setLocating(false);
    };
    navigator.geolocation.getCurrentPosition(
      savePosition,
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          showLocationError(geoError);
          return;
        }
        setLocationMessage('لم نتمكن من تحديد الموقع بدقة عالية؛ نجرب الطريقة العادية…');
        navigator.geolocation.getCurrentPosition(
          savePosition,
          showLocationError,
          { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 },
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!cart.items.length) { setError('سلتك فارغة. أضف بعض المنتجات أولاً.'); return; }
    if (!/^\d{6}$/.test(pin)) { setError('أنشئ رمزاً سرياً من 6 أرقام لمتابعة طلباتك لاحقاً.'); return; }
    setCreating(true);
    try {
      const response = await fetch(`${basePath}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...form, pin, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null, items: cart.items.map((r) => ({ productId: r.product.id, quantity: r.quantity })) }) });
      const responseText = await response.text();
      let order: Record<string, any> = {};
      try { order = responseText ? JSON.parse(responseText) : {}; } catch {
        throw new Error(`استجابة الخادم غير صالحة (HTTP ${response.status}). لم يتم تأكيد الطلب؛ حاول لاحقاً.`);
      }
      if (!response.ok) throw new Error(order.error || `تعذّر تأكيد الطلب (HTTP ${response.status}).`);
      cart.clear();
      const links = order.chatLinks ?? [];
      setLocation('/order-confirmed/' + encodeURIComponent(order.orderCode) + '?chats=' + encodeURIComponent(JSON.stringify(links)));
    } catch (err) { setError(err instanceof Error ? err.message : 'لم نتمكن من إتمام طلبك. راجع بياناتك وحاول مجدداً.'); }
    finally { setCreating(false); }
  };
  return <><Header cartCount={cart.count}/><main className="shell min-h-[70vh] py-10 md:py-16"><div className="mb-8"><p className="text-xs font-bold tracking-widest text-[#ae6e4d]">خطوة أخيرة</p><h1 className="serif mb-1 mt-2 text-4xl font-extrabold">إتمام الطلب</h1><p className="text-sm text-muted-foreground">أكمل بياناتك وأنشئ رمزاً من 6 أرقام لتتمكن من متابعة طلباتك لاحقاً.</p></div><div className="grid gap-8 lg:grid-cols-[1fr_360px]"><form onSubmit={submit} className="space-y-5 rounded-[24px] border bg-card p-5 md:p-8"><h2 className="m-0 text-lg font-bold">بيانات التوصيل</h2><Field label="الاسم الكامل" value={form.buyerName} onChange={(v) => update('buyerName',v)} required placeholder="الاسم الذي نستلم به الطلب"/><div className="grid gap-5 sm:grid-cols-2"><Field label="رقم الجوال" value={form.phone} onChange={(v) => update('phone',v)} required type="tel" placeholder="09xxxxxxxx"/><label className="block text-sm font-semibold">المدينة<select className="field mt-2" required value={form.city} onChange={(e) => update('city',e.target.value)}><option value="">اختر المدينة</option>{sudanCities.map(city=><option key={city} value={city}>{city}</option>)}</select></label></div><label className="block text-sm font-semibold">رمز سري من 6 أرقام (احتفظ به لمتابعة طلباتك)<input className="field mt-2" value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} required type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} pattern="[0-9]{6}" placeholder="••••••"/></label><label className="block text-sm font-semibold">العنوان بالتفصيل<textarea className="field mt-2 min-h-28 resize-y" required value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="الحي، الشارع، رقم المنزل وأي تفاصيل تساعدنا"/></label><div className="rounded-2xl border border-dashed p-4"><button type="button" className="btn !bg-[#e5ece2] !text-[#285e4e]" onClick={locateMe} disabled={locating}><span className="inline-flex items-center gap-2"><MapPin size={17}/>{locating ? 'جارٍ تحديد الموقع…' : coordinates ? 'تحديث موقعي' : 'تحديد موقعي'}</span></button><p className="mb-0 mt-2 text-xs text-muted-foreground">{locationMessage || 'اختياري: أرسل موقعك على الخريطة ليسهل على البائع الوصول إليك. سيطلب الهاتف إذنك أولاً.'}</p></div>{error && <p className="m-0 text-sm text-destructive">{error}</p>}<button disabled={creating} className="btn btn-primary w-full py-4 disabled:opacity-60" data-testid="button-place-order">{creating ? <LoaderCircle className="animate-spin"/> : <PackageCheck size={18}/>} {creating ? 'جارٍ تأكيد الطلب…' : 'تأكيد الطلب'}</button></form>
      <aside className="h-fit rounded-[24px] bg-[#e9e8de] p-5 md:p-6"><h2 className="m-0 text-lg font-bold">ملخص السلة</h2>{cart.items.length ? <div className="mt-5 space-y-4">{cart.items.map(({product,quantity}) => <div key={product.id} className="flex items-center justify-between gap-3 border-b border-[#d3d4c9] pb-4"><div className="min-w-0"><div className="truncate text-sm font-semibold">{product.title}</div><div className="mt-1 flex items-center gap-2"><button className="h-6 w-6 rounded-full bg-white" onClick={() => cart.setQty(product.id,quantity-1)} aria-label="تقليل الكمية">−</button><span className="text-xs">{quantity}</span><button className="h-6 w-6 rounded-full bg-white" onClick={() => cart.setQty(product.id,quantity+1)} aria-label="زيادة الكمية">+</button></div></div><b className="shrink-0 text-sm">{money(product.price*quantity)}</b></div>)}</div> : <p className="py-5 text-sm text-muted-foreground">السلة فارغة حالياً.</p>}<div className="mt-5 flex justify-between text-sm"><span>الإجمالي</span><b>{money(cart.total)}</b></div><div className="mt-4 flex items-center gap-2 text-xs text-[#527264]"><ShieldCheck size={16}/> بياناتك تستخدم لتوصيل الطلب فقط</div></aside></div></main><Footer/></>;
}

function Field({ label, value, onChange, required = false, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string; placeholder?: string }) { return <label className="block text-sm font-semibold">{label}<input className="field mt-2" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder}/></label>; }

function MyOrdersPage() {
  const [phone, setPhone] = useState(''); const [pin, setPin] = useState('');
  const [orders, setOrders] = useState<Array<{id:number;orderCode:string;total:number;status:string;createdAt:string;items:Array<{productTitle:string;sellerName:string;quantity:number}>}>>([]);
  const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false); const [error, setError] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(''); setLoading(true); setSearched(false);
    try { const response = await fetch(`${basePath}/api/buyer/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, pin }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'تعذّر تحميل الطلبات.'); setOrders(data.orders || []); setSearched(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذّر تحميل الطلبات.'); } finally { setLoading(false); }
  };
  return <><Header/><main className="shell min-h-[70vh] py-10 md:py-16"><div className="mx-auto max-w-[760px]"><p className="text-xs font-bold tracking-widest text-[#ae6e4d]">متابعة المشتريات</p><h1 className="serif mt-2 text-4xl font-extrabold">طلباتي</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">أدخل رقم الهاتف والرمز السري اللذين استخدمتهما عند إتمام الطلب.</p>
    <form onSubmit={submit} className="mt-7 grid gap-4 rounded-[24px] border bg-card p-5 md:grid-cols-[1fr_1fr_auto] md:items-end md:p-7"><Field label="رقم الهاتف" value={phone} onChange={setPhone} required type="tel" placeholder="09xxxxxxxx"/><label className="block text-sm font-semibold">الرمز السري<input className="field mt-2" value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} required type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} pattern="[0-9]{6}" placeholder="6 أرقام"/></label><button className="btn btn-primary h-11" disabled={loading}>{loading ? 'جارٍ البحث…' : 'عرض طلباتي'}</button>{error && <p className="m-0 text-sm text-destructive md:col-span-3">{error}</p>}</form>
    {searched && (orders.length ? <div className="mt-8 space-y-4">{orders.map(order => <article key={order.id} className="rounded-[22px] border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="m-0 text-xs text-muted-foreground">طلب {order.orderCode}</p><p className="mb-0 mt-1 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString('ar-SD')}</p></div><span className="status">{statuses[order.status] || order.status}</span></div><div className="my-4 space-y-2 border-y py-3 text-sm">{order.items.map((item,i)=><div key={i} className="flex justify-between gap-3"><span>{item.productTitle} · {item.sellerName}</span><b>× {item.quantity}</b></div>)}</div><div className="text-left text-sm font-bold">الإجمالي: {money(order.total)}</div></article>)}</div> : <div className="mt-8 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا توجد طلبات مرتبطة بهذا الحساب حتى الآن.</div>)}
    <p className="mt-6 text-xs leading-6 text-muted-foreground">إذا نسيت الرمز السري، تواصل مع إدارة جيب لي لإعادة تعيينه بعد مراجعة بياناتك. لأسباب أمنية، الطلبات السابقة لإضافة نظام الرمز قد لا تظهر هنا.</p></div></main><Footer/></>;
}
function OrderConfirmed() {
  const [, params] = useRoute('/order-confirmed/:code');
  let chats:Array<{sellerId:number;sellerName:string;token:string}>=[];
  try{chats=JSON.parse(new URLSearchParams(window.location.search).get('chats')||'[]');}catch{}
  return <><Header/><main className="shell flex min-h-[70vh] items-center justify-center py-14"><div className="w-full max-w-[620px] rounded-[30px] border bg-card p-8 text-center shadow-sm md:p-12"><span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#dcebdc] text-[#2f6958]"><Check size={36}/></span><p className="mt-7 text-xs font-bold tracking-[.18em] text-[#a96c4c]">تم استلام طلبك</p><h1 className="serif mb-3 mt-2 text-4xl font-extrabold">شكراً لاختيارك جيبلي</h1><p className="mx-auto max-w-sm text-sm leading-7 text-muted-foreground">طلبك وصل للبائع. يمكنك مراسلة كل متجر من الروابط التالية دون إنشاء حساب.</p><div className="my-7 rounded-2xl bg-[#f0eee5] p-4"><div className="text-xs text-muted-foreground">رقم الطلب</div><div className="mt-1 font-bold" dir="ltr">{decodeURIComponent(params?.code||'')}</div></div>{chats.length>0&&<div className="mb-7 space-y-2 text-right"><h2 className="font-bold">محادثات المتاجر</h2>{chats.map(chat=><Link key={chat.sellerId} href={`/chat?token=${encodeURIComponent(chat.token)}`} className="flex items-center justify-between rounded-xl border bg-card p-4 text-sm font-semibold text-inherit no-underline"><span>{chat.sellerName}</span><span className="text-[#2b6756]">راسل المتجر ←</span></Link>)}</div>}<div className="flex flex-wrap justify-center gap-3"><Link href="/shop" className="btn btn-primary">تابع اكتشاف المنتجات</Link><Link href="/seller" className="btn btn-outline">لديك متجر؟</Link></div></div></main><Footer/></>;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signPath = mode === 'sign-in' ? `${basePath}/sign-in` : `${basePath}/sign-up`;
  const appearance = { theme: shadcn, cssLayerName: 'clerk', options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` }, variables: { colorPrimary: '#286453', colorForeground: '#25483e', colorMutedForeground: '#68796e', colorBackground: '#fffdf7', colorInput: '#fffdf7', colorInputForeground: '#25483e', colorDanger: '#a8463d', colorNeutral: '#25483e', borderRadius: '14px', fontFamily: "'IBM Plex Sans Arabic', sans-serif" }, elements: { rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fffdf7] rounded-2xl w-[440px] max-w-full overflow-hidden', card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none', headerTitle: 'font-bold text-[#25483e]', headerSubtitle: 'text-[#68796e]', socialButtonsBlockButtonText: 'text-[#25483e]', formFieldLabel: 'text-[#25483e]', footerActionLink: 'text-[#286453]', footerActionText: 'text-[#68796e]', dividerText: 'text-[#68796e]', formFieldInput: 'bg-[#fffdf7] text-[#25483e]', formButtonPrimary: 'font-semibold', main: 'text-[#25483e]' } };
  return <main className="hero-surface min-h-[100dvh] px-4 py-8"><div className="shell"><Link href="/" className="inline-flex items-center gap-2 text-inherit no-underline"><img src="/logo.svg" alt="GEEBLI جيب لي" className="h-12 w-auto"/></Link><div className="mx-auto mt-9 grid max-w-[980px] items-center gap-8 md:grid-cols-[1fr_1fr]"><div className="hidden md:block"><p className="text-sm font-bold tracking-widest text-[#a76b4c]">مساحة لمجتمع جيبلي</p><h1 className="serif max-w-md text-5xl font-extrabold leading-tight">{mode === 'sign-in' ? 'مرحباً بعودتك.' : 'خطوتك الأولى إلى عالم جيبلي.'}</h1><p className="max-w-sm leading-7 text-[#566f62]">سجّل الدخول لإدارة متجرك ومتابعة منتجاتك وطلباتك.</p></div><div className="flex min-h-[500px] items-center justify-center rounded-[28px] border border-[#dad9ce] bg-[#fffdf7] p-5 shadow-[0_25px_65px_rgba(38,70,55,.09)]">{mode === 'sign-in' ? <SignIn routing="path" path={signPath} signUpUrl={`${basePath}/sign-up`} appearance={appearance}/> : <SignUp routing="path" path={signPath} signInUrl={`${basePath}/sign-in`} appearance={appearance}/>}</div></div></div></main>;
}

function SellerPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const query = useGetSellerProfile({ query: { enabled: !!isSignedIn, queryKey: getGetSellerProfileQueryKey() } });
  const apply = useApplyAsSeller();
  const [form, setForm] = useState({ storeName:'', contactName:'', phone:'' });
  const [message, setMessage] = useState('');
  const qc = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage('');
    apply.mutate({ data: form }, {
      onSuccess: () => {
        setMessage('وصل طلبك بنجاح، سنراجعه ونتواصل معك قريباً.');
        qc.invalidateQueries({ queryKey: getGetSellerProfileQueryKey() });
      },
      onError: (error) => setMessage(error instanceof Error ? error.message : 'تعذّر إرسال الطلب. حاول مرة أخرى.'),
    });
  };
  const profileErrorStatus = (query.error as { status?: number } | null)?.status;
  const profileLoadFailed = query.isError && profileErrorStatus !== 404;
  return <><Header/><main className="shell min-h-[70vh] py-10 md:py-16"><div className="grid gap-10 md:grid-cols-[.9fr_1.1fr]"><div><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dce8dc] text-[#326451]"><Store/></span><p className="mt-7 text-xs font-bold tracking-widest text-[#ae6e4d]">لأصحاب المشاريع الصغيرة</p><h1 className="serif mb-4 mt-2 text-4xl font-extrabold leading-tight md:text-5xl">قصتك تستحق<br/>أن تُكتشف.</h1><p className="max-w-sm text-sm leading-7 text-muted-foreground">انضم إلى جيبلي واعرض منتجاتك أمام أشخاص يقدّرون الصنع المحلي. نراجع كل طلب يدوياً قبل فتح المتجر.</p><div className="mt-8 space-y-4"><Benefit icon={<ShieldCheck size={21}/>} title="مراجعة يدوية" text="نحافظ على جودة المتاجر وتنوعها."/><Benefit icon={<PackageCheck size={21}/>} title="إدارة طلبات واضحة" text="تابع التجهيز والشحن من لوحة متجرك."/></div></div>
      <div className="h-fit rounded-[26px] border bg-card p-6 md:p-9">{!authLoaded || (isSignedIn && query.isLoading) ? <div className="h-64 animate-pulse rounded-2xl bg-muted"/> : !isSignedIn ? <div className="py-10 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e8eee3] text-[#366352]"><UserRound/></span><h2 className="mt-5 text-xl font-bold">ابدأ بتسجيل الدخول</h2><p className="mx-auto max-w-xs text-sm leading-7 text-muted-foreground">نحتاج حساباً لربط طلب المتجر بك ومتابعة حالة المراجعة.</p><div className="mt-5 flex justify-center gap-3"><Link href="/sign-in" className="btn btn-primary">تسجيل الدخول</Link><Link href="/sign-up" className="btn btn-outline">إنشاء حساب</Link></div></div> : profileLoadFailed ? <div className="py-10 text-center"><h2 className="text-xl font-bold">تعذّر تحميل حالة طلب المتجر</h2><p className="mt-3 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : 'تحقق من اتصال الخدمة ثم حاول مرة أخرى.'}</p><button type="button" className="btn btn-outline mt-4" onClick={() => query.refetch()}>إعادة المحاولة</button></div> : query.data ? <SellerStatus seller={query.data}/> : <><h2 className="m-0 text-xl font-bold">قدّم طلب متجرك</h2><p className="mt-2 text-sm text-muted-foreground">سنراجع التفاصيل ونتواصل معك لتأكيد الخطوة التالية.</p><form className="mt-7 space-y-5" onSubmit={submit}><Field label="اسم المتجر" value={form.storeName} onChange={(v)=>setForm({...form,storeName:v})} required placeholder="مثال: دار ندى"/><Field label="اسم صاحب المتجر" value={form.contactName} onChange={(v)=>setForm({...form,contactName:v})} required placeholder="الاسم الكامل"/><Field label="رقم التواصل" value={form.phone} onChange={(v)=>setForm({...form,phone:v})} required type="tel" placeholder="05xxxxxxxx"/>{message && <p className={`text-sm ${apply.isError ? "text-destructive" : "text-[#356252]"}`}>{message}</p>}<button className="btn btn-primary w-full" disabled={apply.isPending}>{apply.isPending ? 'جارٍ الإرسال…' : 'إرسال طلب الانضمام'}</button></form></>}</div>
    </div></main><Footer/></>;
}
function SellerStatus({ seller }: { seller: Seller }) {
  const label = statuses[seller.status] || seller.status;
  const icon = seller.status === 'approved' ? <Check/> : seller.status === 'rejected' ? <X/> : <Clock3/>;
  return <div className="py-8 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e8eee3] text-[#366352]">{icon}</span><p className="mt-5 text-xs font-bold tracking-widest text-[#ae6e4d]">طلب متجر</p><h2 className="serif mt-2 text-3xl font-extrabold">{seller.storeName}</h2><span className="status mt-3 inline-block">{label}</span><p className="mx-auto mt-5 max-w-sm text-sm leading-7 text-muted-foreground">{seller.status === 'pending' ? 'طلبك قيد المراجعة اليدوية. سنرسل إليك تحديثاً عند اكتمالها.' : seller.status === 'approved' ? 'تم اعتماد متجرك. أرسل إشعار الاشتراك الشهري وانتظر تأكيد الإدارة لتتمكن من إدارة المنتجات والطلبات.' : 'لم تتم الموافقة على الطلب الحالي. تواصل مع فريق جيبلي لمعرفة التفاصيل.'}</p>{seller.status === 'approved' && <div className="mt-5 flex flex-wrap justify-center gap-2"><Link className="btn btn-primary" href="/seller/subscription">الاشتراك الشهري <ArrowUpLeft size={16}/></Link><Link className="btn btn-outline" href="/seller/dashboard">لوحة المتجر</Link></div>}</div>;
}

function SellerLayout({ children, title, active }: { children: ReactNode; title: string; active: string }) {
  return <div className="min-h-[100dvh] bg-[#f4f1e7]"><header className="border-b border-[#dfe3d8] bg-[#fffdf7]/95 shadow-sm"><div className="shell flex h-[72px] items-center justify-between"><Link href="/" className="inline-flex items-center no-underline"><img src="/logo.svg" alt="GEEBLI جيب لي" className="h-11 w-auto"/></Link><Link href="/" className="text-sm text-muted-foreground no-underline">العودة للمتجر</Link></div></header><div className="shell grid gap-7 py-8 md:grid-cols-[220px_1fr] md:py-10"><aside className="h-fit rounded-[22px] bg-[#17483e] p-4 text-[#f6f0e4]"><p className="px-3 text-xs text-[#c0d1c5]">مساحة البائع</p><h2 className="px-3 text-xl font-bold">{title}</h2><div className="mt-5 space-y-4"><section><p className="px-3 pb-1 text-[11px] font-bold text-[#c0d1c5]">إدارة المتجر</p><div className="grid grid-cols-3 gap-2 md:grid-cols-1">{[['/seller/dashboard','نظرة عامة'],['/seller/products','المنتجات'],['/seller/orders','الطلبات'],['/seller/subscription','الاشتراك']].map(([href,label]) => <Link key={href} href={href} className={`rounded-xl px-3 py-3 text-xs no-underline md:text-sm ${active === href ? 'bg-[#2a6253] text-white' : 'text-[#d6e0d8] hover:bg-white/10'}`}>{label}</Link>)}</div></section><section className="border-t border-white/15 pt-3"><p className="px-3 pb-1 text-[11px] font-bold text-[#c0d1c5]">التواصل مع العملاء</p><Link href="/seller/chats" className={`block rounded-xl px-3 py-3 text-xs no-underline md:text-sm ${active === '/seller/chats' ? 'bg-[#2a6253] text-white' : 'text-[#d6e0d8] hover:bg-white/10'}`}>محادثات العملاء</Link></section></div></aside><main className="min-w-0">{children}</main></div></div>;
}
function SellerDashboard() {
  const products = useListSellerProducts(); const orders = useListSellerOrders();
  return <SellerLayout title="لوحة المتجر" active="/seller/dashboard"><div className="mb-7"><p className="text-xs font-bold tracking-widest text-[#a96f4f]">مرحباً بك</p><h1 className="serif mb-0 mt-2 text-3xl font-extrabold">ملخص متجرك</h1></div>{products.isLoading || orders.isLoading ? <div className="grid gap-4 md:grid-cols-3">{[1,2,3].map(x=><div className="h-28 animate-pulse rounded-2xl bg-muted" key={x}/>)}</div> : <><div className="grid gap-4 sm:grid-cols-3"><Metric label="منتجاتك" value={products.data?.length ?? 0} icon={<Box/>}/><Metric label="طلبات جديدة" value={orders.data?.filter(o=>o.status==='new').length ?? 0} icon={<PackagePlus/>}/><Metric label="إجمالي الطلبات" value={orders.data?.length ?? 0} icon={<ShoppingBag/>}/></div><div className="mt-8 flex flex-wrap items-center justify-between gap-4"><h2 className="m-0 text-lg font-bold">أحدث الطلبات</h2><Link href="/seller/products" className="btn btn-primary">إدارة المنتجات</Link></div><OrdersTable orders={(orders.data ?? []).slice(0,5)}/></>}</SellerLayout>;
}
function Metric({ label, value, icon }: {label:string;value:number|string;icon:ReactNode}) { return <div className="rounded-[20px] border bg-card p-5"><div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">{label}</span><span className="text-[#38715d]">{icon}</span></div><div className="mt-3 text-3xl font-extrabold">{value}</div></div>; }
function SellerProducts() {
  const query = useListSellerProducts(); const remove = useDeleteSellerProduct(); const update = useUpdateSellerProduct(); const qc=useQueryClient();
  const refresh=()=>qc.invalidateQueries({queryKey:getListSellerProductsQueryKey()});
  return <SellerLayout title="المنتجات" active="/seller/products"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-widest text-[#a96f4f]">كتالوجك</p><h1 className="serif mb-0 mt-1 text-3xl font-extrabold">إدارة المنتجات</h1></div><Link href="/seller/products/new" className="btn btn-primary"><PackagePlus size={17}/> أضف منتجاً</Link></div>
    {query.isLoading ? <LoadingGrid/> : query.isError ? <Retry text="تعذّر تحميل المنتجات" onRetry={()=>query.refetch()}/> : query.data?.length ? <div className="table-wrap"><table><thead><tr><th>المنتج</th><th>الفئة</th><th>السعر</th><th>المخزون</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{query.data.map((p)=><tr key={p.id}><td className="font-semibold">{p.title}</td><td>{p.category}</td><td>{money(p.price)}</td><td>{p.stock}</td><td><span className="status">{p.active?'نشط':'موقوف'}</span></td><td><div className="flex gap-2"><button className="btn btn-quiet !px-3 !py-2 text-xs" disabled={update.isPending} onClick={()=>update.mutate({id:p.id,data:{active:!p.active}},{onSuccess:refresh})}>{p.active?'إيقاف':'تفعيل'}</button><button className="btn !bg-[#f4ded6] !px-3 !py-2 text-xs text-[#8b4235]" onClick={()=>{if(window.confirm('هل تريد حذف هذا المنتج؟')) remove.mutate({id:p.id},{onSuccess:refresh});}}>حذف</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="لم تضف منتجات بعد" text="ابدأ بإضافة أول منتج إلى متجرك." action={<Link href="/seller/products/new" className="btn btn-primary">إضافة منتج</Link>}/>}
  </SellerLayout>;
}
function NewProduct() {
  const create=useCreateSellerProduct(); const qc=useQueryClient(); const [,setLocation]=useLocation();
  const { getToken }=useAuth();
  const [form,setForm]=useState({title:'',description:'',category:'',price:'',imageUrl:'',stock:''});
  const [error,setError]=useState(''); const [uploading,setUploading]=useState(false);
  const [progress,setProgress]=useState(0); const [selectedFile,setSelectedFile]=useState<File|null>(null);
  const uploadSelectedImage=async(file:File)=>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('اختر صورة JPG أو PNG أو WebP.');return;}
    if(file.size<=0||file.size>5*1024*1024){setError('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');return;}
    setSelectedFile(file);setError('');setUploading(true);setProgress(0);
    try{
      const token=await getToken(); if(!token) throw new Error('سجّل الدخول مرة أخرى.');
      let imageUrl:string;
      try{
        const signResponse=await fetch(`${basePath}/api/seller/product-image/sign`,{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({contentType:file.type,size:file.size})
        });
        const signText=await signResponse.text();
        let signed:{error?:string;uploadUrl?:string;imageUrl?:string};
        try{signed=JSON.parse(signText) as typeof signed;}
        catch{throw new Error(`تعذّر تجهيز رابط الرفع (HTTP ${signResponse.status}).`);}
        if(!signResponse.ok||!signed.uploadUrl||!signed.imageUrl) throw new Error(signed.error||'تعذّر تجهيز رابط رفع الصورة.');
        await new Promise<void>((resolve,reject)=>{
          const xhr=new XMLHttpRequest();
          xhr.open('PUT',signed.uploadUrl!);
          xhr.setRequestHeader('Content-Type',file.type);
          xhr.upload.onprogress=(event)=>{if(event.lengthComputable)setProgress(Math.round((event.loaded/event.total)*100));};
          xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else reject(new Error(`فشل رفع الصورة (HTTP ${xhr.status}).`));};
          xhr.onerror=()=>reject(new Error('تعذّر الاتصال بمخزن الصور.'));
          xhr.ontimeout=()=>reject(new Error('انتهت مهلة رفع الصورة.'));
          xhr.timeout=120000;
          xhr.send(file);
        });
        imageUrl=signed.imageUrl;
      }catch(directError){
        setProgress(10);
        const encoded=await new Promise<string>((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
          reader.onerror=()=>reject(new Error('تعذرت قراءة الصورة من الجهاز.'));
          reader.readAsDataURL(file);
        });
        const fallbackResponse=await fetch(`${basePath}/api/seller/product-image`,{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({contentType:file.type,imageData:encoded})
        });
        const fallbackText=await fallbackResponse.text();
        let fallback:{error?:string;imageUrl?:string};
        try{fallback=JSON.parse(fallbackText) as typeof fallback;}
        catch{throw new Error(`فشل الرفع المباشر والاحتياطي (HTTP ${fallbackResponse.status}).`);}
        if(!fallbackResponse.ok||!fallback.imageUrl){
          const reason=fallback.error||'تعذّر حفظ الصورة على الخادم.';
          const directReason=directError instanceof Error?directError.message:'';
          throw new Error(directReason?`${reason} السبب الأول: ${directReason}`:reason);
        }
        imageUrl=fallback.imageUrl;
      }
      setForm(f=>({...f,imageUrl}));
      setProgress(100);
      setError('');
    }catch(err){setError(err instanceof Error?err.message:'فشل رفع الصورة.');}
    finally{setUploading(false);}
  };
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');create.mutate({data:{title:form.title,description:form.description,category:form.category,price:Number(form.price),stock:Number(form.stock),imageUrl:form.imageUrl||null}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListSellerProductsQueryKey()});setLocation('/seller/products');},onError:()=>setError('تعذّر حفظ المنتج. تأكد من صحة البيانات.')});};
  return <SellerLayout title="منتج جديد" active="/seller/products"><Link href="/seller/products" className="text-sm text-muted-foreground no-underline">المنتجات / إضافة منتج</Link><h1 className="serif mt-3 text-3xl font-extrabold">أضف منتجاً جديداً</h1><form className="mt-6 max-w-[760px] space-y-5 rounded-[24px] border bg-card p-5 md:p-8" onSubmit={submit}><Field label="اسم المنتج" value={form.title} onChange={v=>setForm({...form,title:v})} required placeholder="اكتب اسماً واضحاً"/><label className="block text-sm font-semibold">وصف المنتج<textarea className="field mt-2 min-h-32" required value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="ما الذي يجعل هذا المنتج مميزاً؟"/></label><div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-semibold">تصنيف المنتج<select className="field mt-2" required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="">اختر تصنيف المنتج</option>{productCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label><Field label="السعر بالجنيه السوداني" type="number" value={form.price} onChange={v=>setForm({...form,price:v})} required placeholder="0.00"/></div><div className="grid gap-5 sm:grid-cols-2"><Field label="الكمية المتاحة" type="number" value={form.stock} onChange={v=>setForm({...form,stock:v})} required placeholder="العدد"/><label className="block text-sm font-semibold">صورة المنتج (اختياري)<input className="field mt-2" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)uploadSelectedImage(file);}}/><span className="mt-1 block text-xs text-muted-foreground">رفع مباشر من جهازك — JPG/PNG/WebP — حتى 5 ميجابايت</span></label></div>{form.imageUrl&&<img src={form.imageUrl} alt="معاينة صورة المنتج" className="h-36 w-36 rounded-xl border object-cover"/>}{uploading&&<div><p className="text-sm">جارٍ الرفع مباشرة إلى مخزن الصور… {progress}%</p><progress className="h-2 w-full" value={progress} max="100"/></div>}{error&&<div className="space-y-2"><p className="text-sm text-destructive">{error}</p>{selectedFile&&!uploading&&<button type="button" className="btn btn-outline" onClick={()=>uploadSelectedImage(selectedFile)}>إعادة محاولة رفع الصورة</button>}</div>}<div className="flex gap-3"><button className="btn btn-primary" disabled={create.isPending||uploading}>{create.isPending?'جارٍ الحفظ…':'حفظ المنتج'}</button><Link href="/seller/products" className="btn btn-outline">إلغاء</Link></div></form></SellerLayout>;
}
function GuestChat() {
  const token=new URLSearchParams(window.location.search).get('token')||'';
  const [chat,setChat]=useState<{sellerName:string;orderCode:string;messages:Array<{id:number;senderType:string;body:string;createdAt:string}>}|null>(null);
  const [message,setMessage]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const load=async()=>{const r=await fetch(`${basePath}/api/chat/guest`,{headers:{'x-geebli-chat-token':token}});const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر تحميل المحادثة');setChat(d);};
  useEffect(()=>{if(!token){setError('رابط المحادثة غير صالح.');return;}load().catch(e=>setError(e.message));const timer=window.setInterval(()=>load().catch(()=>{}),5000);return()=>window.clearInterval(timer);},[token]);
  const send=async(e:FormEvent)=>{e.preventDefault();if(!message.trim())return;setBusy(true);setError('');try{const r=await fetch(`${basePath}/api/chat/guest/messages`,{method:'POST',headers:{'Content-Type':'application/json','x-geebli-chat-token':token},body:JSON.stringify({message})});const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر إرسال الرسالة');setMessage('');await load();}catch(e){setError(e instanceof Error?e.message:'تعذّر إرسال الرسالة');}finally{setBusy(false);}};
  return <><Header/><main className="shell min-h-[70vh] py-10"><div className="mx-auto max-w-[720px] rounded-3xl border bg-card p-5 md:p-8"><h1 className="serif text-3xl font-extrabold">محادثة مع {chat?.sellerName||'المتجر'}</h1><p className="text-sm text-muted-foreground">طلب رقم {chat?.orderCode||''}</p><div className="my-6 max-h-[55vh] min-h-48 space-y-3 overflow-y-auto rounded-2xl bg-muted/40 p-4">{chat?.messages.map(m=><div key={m.id} className={m.senderType==='buyer'?'mr-auto max-w-[85%] rounded-2xl bg-[#dcebdc] p-3 text-sm':'ml-auto max-w-[85%] rounded-2xl bg-white p-3 text-sm'}>{m.body}</div>)}</div><form onSubmit={send} className="flex gap-2"><input className="field min-w-0 flex-1" value={message} onChange={e=>setMessage(e.target.value)} placeholder="اكتب رسالتك…" maxLength={2000}/><button className="btn btn-primary" disabled={busy||!message.trim()}>{busy?'إرسال…':'إرسال'}</button></form>{error&&<p className="mt-3 text-sm text-destructive">{error}</p>}</div></main><Footer/></>;
}
function SellerChats() {
  const {getToken}=useAuth(); const [list,setList]=useState<Array<{id:number;orderCode:string;buyerName:string;buyerPhone:string;lastMessage:string}>>([]);
  const [chat,setChat]=useState<{id:number;orderCode:string;buyerName:string;buyerPhone:string;messages:Array<{id:number;senderType:string;body:string}>}|null>(null);
  const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [,params]=useRoute('/seller/chats/:id'); const chatId=params?.id;
  const authFetch=async(path:string,init:RequestInit={})=>{const token=await getToken();if(!token)throw new Error('سجّل الدخول مرة أخرى.');return fetch(`${basePath}/api${path}`,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(init.headers||{})}});};
  const load=async()=>{if(chatId){const r=await authFetch(`/seller/chats/${chatId}`);const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر تحميل المحادثة');setChat(d);}else{const r=await authFetch('/seller/chats');const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر تحميل المحادثات');setList(d);}};
  useEffect(()=>{load().catch(e=>setError(e.message));const timer=window.setInterval(()=>load().catch(()=>{}),5000);return()=>window.clearInterval(timer);},[chatId]);
  const send=async(e:FormEvent)=>{e.preventDefault();if(!chatId||!message.trim())return;setBusy(true);try{const r=await authFetch(`/seller/chats/${chatId}/messages`,{method:'POST',body:JSON.stringify({message})});const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر إرسال الرسالة');setMessage('');await load();}catch(e){setError(e instanceof Error?e.message:'تعذّر إرسال الرسالة');}finally{setBusy(false);}};
  return <SellerLayout title="محادثات العملاء" active="/seller/chats"><h1 className="serif mb-5 text-3xl font-extrabold">محادثات العملاء</h1>{error&&<p className="text-sm text-destructive">{error}</p>}{chatId?<><Link href="/seller/chats" className="text-sm text-[#2b6756]">← كل المحادثات</Link><div className="mt-3 space-y-1 text-sm"><p>العميل: {chat?.buyerName}</p><p>رقم الطلب: {chat?.orderCode}</p><p dir="ltr" className="text-right">الهاتف: <a className="underline" href={`tel:${chat?.buyerPhone}`}>{chat?.buyerPhone}</a></p></div><div className="my-5 max-h-[50vh] min-h-48 space-y-3 overflow-y-auto rounded-2xl border p-4">{chat?.messages.map(m=><div key={m.id} className={m.senderType==='seller'?'ml-auto max-w-[85%] rounded-2xl bg-[#dcebdc] p-3 text-sm':'mr-auto max-w-[85%] rounded-2xl bg-muted p-3 text-sm'}>{m.body}</div>)}</div><form onSubmit={send} className="flex gap-2"><input className="field min-w-0 flex-1" value={message} onChange={e=>setMessage(e.target.value)} placeholder="اكتب ردك…" maxLength={2000}/><button className="btn btn-primary" disabled={busy||!message.trim()}>إرسال</button></form></>:list.length?<div className="space-y-2">{list.map(c=><Link key={c.id} href={`/seller/chats/${c.id}`} className="block rounded-2xl border bg-card p-4 text-inherit no-underline"><b>{c.buyerName}</b><p className="mt-1 text-xs text-muted-foreground">طلب {c.orderCode} · <span dir="ltr">{c.buyerPhone}</span></p><p className="mb-0 mt-2 text-sm text-muted-foreground">{c.lastMessage||'ابدأ المحادثة'}</p></Link>)}</div>:<EmptyState title="لا توجد محادثات بعد" text="ستظهر هنا رسائل المشترين بعد إتمام الطلبات."/>}</SellerLayout>;
}

function SellerSubscription() {
  const { getToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [method, setMethod] = useState("bankak");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    const token = await getToken();
    if (!token) throw new Error("سجّل الدخول مرة أخرى.");
    const response = await fetch(`${basePath}/api/seller/subscription`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذّر تحميل بيانات الاشتراك.");
    setData(result);
  };
  useEffect(() => { load().catch(e => setError(e instanceof Error ? e.message : "تعذّر تحميل الاشتراك.")); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setNotice("");
    if (!file) { setError("ارفق صورة إشعار الدفع أولاً."); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError("اختر صورة JPG أو PNG أو WebP لا تتجاوز 5 ميجابايت."); return; }
    setBusy(true);
    try {
      const token = await getToken(); if (!token) throw new Error("سجّل الدخول مرة أخرى.");
      const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error("تعذرت قراءة الصورة.")); reader.readAsDataURL(file); });
      const response = await fetch(`${basePath}/api/seller/subscription`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ paymentMethod: method, contentType: file.type, receiptData: encoded }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "تعذّر إرسال الإشعار.");
      setNotice("وصل إشعار الدفع. ستراجع الإدارة الإيصال قبل تفعيل الاشتراك."); setFile(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر إرسال طلب الاشتراك."); }
    finally { setBusy(false); }
  };
  return <SellerLayout title="الاشتراك الشهري" active="/seller/subscription"><p className="text-xs font-bold tracking-widest text-[#a96f4f]">تجديد المتجر</p><h1 className="serif mt-1 text-3xl font-extrabold">الاشتراك الشهري</h1>{!data ? <div className="mt-6 h-40 animate-pulse rounded-2xl bg-muted"/> : <div className="mt-6 grid max-w-3xl gap-5">
    <section className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">قيمة الاشتراك الشهري</p><div className="mt-2 text-3xl font-extrabold">{money(Number(data.settings.monthlyAmount || 0))}</div><p className="mt-3 text-sm">حالة المتجر: <b>{data.hasActiveSubscription ? "اشتراك نشط" : "الاشتراك غير نشط"}</b></p><p className="mt-1 text-sm text-muted-foreground">تاريخ الانتهاء: {data.seller.subscriptionExpiresAt ? new Date(data.seller.subscriptionExpiresAt).toLocaleDateString("ar-SD") : "لم يبدأ الاشتراك بعد"}</p></section>
    {data.latestPayment?.status === "pending" && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">لديك إشعار دفع قيد المراجعة منذ {new Date(data.latestPayment.submittedAt).toLocaleDateString("ar-SD")}. لا ترسل إشعاراً آخر قبل اكتمال المراجعة.</section>}
    {data.latestPayment?.status === "rejected" && <section className="rounded-2xl border bg-card p-4 text-sm">آخر طلب دفع مرفوض. {data.latestPayment.reviewNote || "يمكنك إرسال إشعار جديد بعد مراجعة تفاصيل الدفع."}</section>}
    <section className="rounded-2xl border bg-card p-5"><h2 className="text-lg font-bold">تفاصيل الدفع</h2><p className="mt-1 text-sm text-muted-foreground">حوّل المبلغ بالطريقة المناسبة، ثم ارفع صورة الإشعار.</p><div className="mt-4 space-y-3 text-sm"><p><b>اسم المستلم:</b> {data.settings.recipientName || "لم تحدد الإدارة اسم المستلم بعد"}</p><p><b>بنكك:</b> {data.settings.bankakAccount || "غير متاح حالياً"}</p><p><b>فوري:</b> {data.settings.fawryAccount || "غير متاح حالياً"}</p><p><b>الدفع النقدي:</b> {data.settings.cashInstructions || "راجع الإدارة لتحديد مكان الدفع"}</p></div></section>
    <form onSubmit={submit} className="rounded-2xl border bg-card p-5"><h2 className="text-lg font-bold">إرسال إشعار الدفع</h2><label className="mt-4 block text-sm font-semibold">طريقة الدفع<select className="field mt-2" value={method} onChange={e=>setMethod(e.target.value)}><option value="bankak">بنكك</option><option value="fawry">فوري</option><option value="cash">كاش</option></select></label><label className="mt-4 block text-sm font-semibold">صورة إشعار الدفع<input className="field mt-2" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0] || null)}/><span className="mt-1 block text-xs text-muted-foreground">JPG أو PNG أو WebP — حتى 5 ميجابايت. الإيصال محفوظ بصورة خاصة ولا يظهر للزوار.</span></label>{file && <p className="mt-2 text-xs text-muted-foreground">{file.name}</p>}{error && <p className="mt-3 text-sm text-destructive">{error}</p>}{notice && <p className="mt-3 text-sm text-[#286047]">{notice}</p>}<button className="btn btn-primary mt-5 w-full" disabled={busy || data.latestPayment?.status === "pending" || Number(data.settings.monthlyAmount) <= 0}>{busy ? "جارٍ إرسال الإشعار…" : "إرسال للإدارة للمراجعة"}</button></form>
  </div>}</SellerLayout>;
}

function AdminSubscriptions() {
  const { getToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ monthlyAmount: "", recipientName: "", bankakAccount: "", fawryAccount: "", cashInstructions: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const load = async () => {
    const token = await getToken(); if (!token) throw new Error("سجّل الدخول مرة أخرى.");
    const r = await fetch(basePath + "/api/admin/subscriptions", { headers: { Authorization: "Bearer " + token } });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "تعذّر تحميل الاشتراكات.");
    setData(d); setForm({ monthlyAmount: String(d.settings.monthlyAmount || ""), recipientName: d.settings.recipientName || "", bankakAccount: d.settings.bankakAccount || "", fawryAccount: d.settings.fawryAccount || "", cashInstructions: d.settings.cashInstructions || "" });
  };
  useEffect(() => { load().catch(e => setError(e instanceof Error ? e.message : "تعذّر تحميل الاشتراكات.")); }, []);
  const request = async (path: string, init: RequestInit = {}) => { const token = await getToken(); if (!token) throw new Error("سجّل الدخول مرة أخرى."); const r = await fetch(basePath + "/api" + path, { ...init, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(init.headers || {}) } }); const d = r.status === 204 ? null : await r.json(); if (!r.ok) throw new Error(d?.error || "تعذّر تنفيذ العملية."); return d; };
  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(""); setNotice(""); try { await request("/admin/subscription-settings", { method: "PUT", body: JSON.stringify({ ...form, monthlyAmount: Number(form.monthlyAmount) }) }); setNotice("تم حفظ إعدادات الدفع."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر حفظ الإعدادات."); } finally { setBusy(false); } };
  const decide = async (id: number, status: "approved" | "rejected") => { setBusy(true); setError(""); setNotice(""); try { await request("/admin/subscriptions/" + id + "/decision", { method: "PATCH", body: JSON.stringify({ status }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "تعذّرت مراجعة الإيصال."); } finally { setBusy(false); } };
  const showReceipt = async (id: number) => { try { const d = await request("/admin/subscriptions/" + id + "/receipt"); setReceipt(d.url); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر فتح الإيصال."); } };
  const resetEarnings = async () => {
    setConfirmReset(false); setBusy(true); setError(""); setNotice("");
    try { await request("/admin/subscriptions/earnings/reset", { method: "POST", body: JSON.stringify({}) }); await load(); setNotice("تم تصفير عداد أرباح الاشتراكات. سجلات الدفع محفوظة."); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر تصفير الأرباح."); }
    finally { setBusy(false); }
  };
  return <AdminLayout active="/admin/subscriptions">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.2em] text-[#a96f4f]">إدارة الإيرادات</p><h1 className="serif mt-2 text-3xl font-extrabold text-[#173f37] md:text-4xl">اشتراكات البائعين</h1><p className="mt-2 text-sm text-[#68796e]">إعداد الرسوم ومراجعة الإيصالات ومتابعة دخل الاشتراكات.</p></div><span className="inline-flex items-center gap-2 rounded-full border border-[#d8e3d8] bg-white/80 px-4 py-2 text-xs font-semibold text-[#315b4b]"><Wallet size={15}/> مركز الإيرادات</span></div>
    {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!data ? <div className="mt-5 h-40 animate-pulse rounded-2xl bg-muted"/> : <>
      <section className="mb-6 overflow-hidden rounded-[26px] bg-gradient-to-br from-[#123e35] via-[#1b5949] to-[#2d735c] p-6 text-white shadow-[0_18px_45px_rgba(23,72,62,.16)] md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><div className="flex items-center gap-2 text-sm text-[#d6e8dc]"><Wallet size={18}/> إجمالي أرباح الاشتراكات</div><div className="mt-4 text-4xl font-extrabold tracking-tight md:text-5xl">{money(Number(data.earningsTotal || 0))}</div><p className="mt-3 text-xs text-[#d0e0d6]">يُحتسب المبلغ من الاشتراكات التي تم اعتمادها فقط، منذ آخر تصفير للعداد.</p></div>
          <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/20 disabled:opacity-50" disabled={busy} onClick={()=>setConfirmReset(true)}><RotateCcw size={16}/> تصفير الأرباح</button>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-4 text-xs text-[#d0e0d6]"><span>آخر تصفير: {data.earningsResetAt ? new Date(data.earningsResetAt).toLocaleString("ar-SD") : "لم يتم التصفير من قبل"}</span><span>سجلات الدفع تبقى محفوظة بعد التصفير</span></div>
      </section>
      <form onSubmit={save} className="rounded-[24px] border border-[#e0e5dc] bg-white/90 p-5 shadow-[0_10px_30px_rgba(37,68,50,.05)] md:p-7">
        <div className="mb-5 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8f0e7] text-[#2e6652]"><Settings2 size={21}/></span><div><h2 className="m-0 text-lg font-extrabold text-[#21483d]">إعدادات الدفع والاشتراك</h2><p className="m-0 mt-1 text-xs text-[#748276]">تظهر هذه البيانات للبائع عند تجديد اشتراكه.</p></div></div>
        <div className="grid gap-4 md:grid-cols-2"><Field label="قيمة الاشتراك الشهري بالجنيه السوداني" type="number" value={form.monthlyAmount} onChange={v=>setForm({...form,monthlyAmount:v})} required/><Field label="اسم المستلم" value={form.recipientName} onChange={v=>setForm({...form,recipientName:v})}/><Field label="رقم/حساب بنكك" value={form.bankakAccount} onChange={v=>setForm({...form,bankakAccount:v})}/><Field label="رقم/حساب فوري" value={form.fawryAccount} onChange={v=>setForm({...form,fawryAccount:v})}/></div>
        <label className="mt-4 block text-sm font-semibold text-[#294b40]">تعليمات الدفع النقدي<textarea className="field mt-2 min-h-24" value={form.cashInstructions} onChange={e=>setForm({...form,cashInstructions:e.target.value})}/></label>
        <button className="btn btn-primary mt-5" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ إعدادات الاشتراك"}</button>
      </form>
      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f0e7] text-[#2e6652]"><ReceiptText size={19}/></span><div><h2 className="m-0 text-xl font-extrabold text-[#21483d]">طلبات الدفع والإيصالات</h2><p className="m-0 mt-1 text-xs text-[#748276]">راجع الإيصال ثم اعتمد الدفع أو ارفضه.</p></div></div><span className="rounded-full bg-[#e9eee6] px-3 py-1.5 text-xs font-bold text-[#315b4b]">{data.payments.length} طلب</span></div>
      {data.payments.length ? <div className="grid gap-3">{data.payments.map((p:any)=><section key={p.id} className="rounded-[20px] border border-[#e0e5dc] bg-white p-4 shadow-[0_8px_24px_rgba(37,68,50,.04)] md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><b className="text-[#21483d]">{p.sellerName}</b><p className="mt-1 text-xs text-muted-foreground">{p.sellerPhone} · {p.sellerEmail}</p><p className="mt-2 text-sm font-semibold">المبلغ: {money(p.amount)} · الطريقة: {p.paymentMethod === "bankak" ? "بنكك" : p.paymentMethod === "fawry" ? "فوري" : "كاش"}</p><p className="text-xs text-muted-foreground">تاريخ الإرسال: {new Date(p.submittedAt).toLocaleString("ar-SD")} · الحالة: {statuses[p.status]}</p></div><button className="btn btn-outline" onClick={()=>showReceipt(p.id)}>عرض الإيصال</button></div>{p.status === "pending" && <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy} onClick={()=>decide(p.id,"approved")}>تأكيد الدفع وتفعيل شهر</button><button className="btn btn-outline" disabled={busy} onClick={()=>decide(p.id,"rejected")}>رفض الإيصال</button></div>}{p.periodEnd && <p className="mt-2 text-xs text-muted-foreground">ينتهي الاشتراك: {new Date(p.periodEnd).toLocaleDateString("ar-SD")}</p>}</section>)}</div> : <p className="mt-3 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا توجد طلبات دفع حتى الآن.</p>}
      {receipt && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={()=>setReceipt("")}><div className="max-h-[90vh] max-w-2xl rounded-2xl bg-card p-3" onClick={e=>e.stopPropagation()}><button className="btn btn-outline mb-3" onClick={()=>setReceipt("")}>إغلاق</button><img src={receipt} alt="إيصال دفع الاشتراك" className="max-h-[75vh] max-w-full object-contain"/></div></div>}
    </>}
    {confirmReset && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#102b24]/65 p-4" role="presentation" onClick={()=>!busy && setConfirmReset(false)}><section role="alertdialog" aria-modal="true" aria-labelledby="reset-earnings-title" aria-describedby="reset-earnings-description" className="w-full max-w-md rounded-[24px] border border-[#e1e7dd] bg-white p-6 text-right shadow-2xl" onClick={e=>e.stopPropagation()}><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0e8] text-[#a65335]"><RotateCcw size={22}/></div><h2 id="reset-earnings-title" className="m-0 text-xl font-extrabold text-[#21483d]">هل أنت متأكد أنك تريد تصفير أرباح الاشتراكات؟</h2><p id="reset-earnings-description" className="mb-0 mt-3 text-sm leading-7 text-[#65756a]">سيتم تصفير عداد الأرباح فقط، ولن يتم حذف سجلات المدفوعات أو الإيصالات أو التأثير على اشتراكات البائعين.</p><div className="mt-6 flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={resetEarnings}>نعم، صفّر الأرباح</button><button type="button" className="btn btn-outline" disabled={busy} onClick={()=>setConfirmReset(false)}>إلغاء</button></div></section></div>}
  </AdminLayout>;
}

function SellerOrders() { const query=useListSellerOrders(); return <SellerLayout title="الطلبات" active="/seller/orders"><h1 className="serif mt-1 text-3xl font-extrabold">طلبات متجرك</h1>{query.isLoading?<div className="h-48 animate-pulse rounded-2xl bg-muted"/>:query.isError?<Retry text="تعذّر تحميل الطلبات" onRetry={()=>query.refetch()}/>:query.data?.length?<OrdersTable orders={query.data} canManage/>:<EmptyState title="لا توجد طلبات بعد" text="ستظهر الطلبات الجديدة هنا عند إتمام عملية شراء."/>}</SellerLayout>; }
function OrdersTable({ orders, canManage = false }: {orders:Order[];canManage?:boolean}) { const update=useUpdateOrderStatus();const qc=useQueryClient(); const refresh=()=>{qc.invalidateQueries({queryKey:getListSellerOrdersQueryKey()});qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()});}; return <div className="table-wrap mt-4"><table><thead><tr><th>رقم الطلب</th><th>اسم العميل</th><th>رقم التلفون</th><th>المدينة</th><th>عنوان التوصيل</th><th>المنتجات</th><th>الإجمالي</th><th>الحالة</th>{canManage&&<th>تحديث الحالة</th>}</tr></thead><tbody>{orders.map(o=><tr key={o.id}><td dir="ltr" className="text-right font-semibold">{o.orderCode}</td><td>{o.buyerName}</td><td dir="ltr" className="text-right"><a href={`tel:${o.phone}`} className="text-inherit underline">{o.phone}</a></td><td>{o.city}</td><td className="min-w-[220px] whitespace-pre-wrap">{o.address}{o.latitude != null && o.longitude != null && <a className="mt-2 inline-flex items-center gap-1 font-semibold text-[#2b6756] underline" href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`} target="_blank" rel="noreferrer"><MapPin size={14}/> عرض الموقع على الخريطة</a>}</td><td className="min-w-[180px]"><div className="space-y-1">{o.items.map((item)=><div key={item.productId}>{item.productTitle} × {item.quantity}</div>)}</div></td><td>{money(o.total)}</td><td><span className="status">{statuses[o.status]}</span></td>{canManage&&<td><select className="field !w-auto !py-2 text-xs" value={o.status} onChange={(e)=>update.mutate({id:o.id,data:{status:e.target.value as OrderStatus}},{onSuccess:refresh})} data-testid={`select-order-status-${o.id}`}>{(['new','preparing','shipped','delivered','cancelled'] as OrderStatus[]).map(s=><option key={s} value={s}>{statuses[s]}</option>)}</select></td>}</tr>)}</tbody></table></div>; }
function Retry({text,onRetry}:{text:string;onRetry:()=>void}) { return <div className="rounded-2xl border border-dashed p-10 text-center"><p className="font-semibold">{text}</p><button className="btn btn-primary mt-2" onClick={onRetry}>إعادة المحاولة</button></div>; }
function EmptyState({title,text,action}:{title:string;text:string;action?:ReactNode}) { return <div className="rounded-[24px] border border-dashed bg-card px-5 py-14 text-center"><PackageCheck className="mx-auto mb-3 text-[#6c8b7c]"/><h2 className="m-0 text-lg font-bold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p>{action&&<div className="mt-5">{action}</div>}</div>; }

function AdminLayout({children,active}:{children:ReactNode;active:string}) {
  const links = [
    { href: "/admin", label: "نظرة عامة", icon: <LayoutDashboard size={18}/> },
    { href: "/admin/sellers", label: "طلبات البائعين", icon: <Users size={18}/> },
    { href: "/admin/orders", label: "إدارة الطلبات", icon: <ShoppingBag size={18}/> },
    { href: "/admin/subscriptions", label: "الاشتراكات والأرباح", icon: <Wallet size={18}/> },
  ];
  return <div className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_top_right,_#e8eee5_0%,_#f5f3eb_48%,_#f1f0e8_100%)]">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#123e35] text-[#fff9ed] shadow-[0_8px_28px_rgba(18,62,53,.16)]">
      <div className="shell flex h-[76px] items-center justify-between gap-4">
        <Link href="/" className="inline-flex items-center gap-3 text-inherit no-underline"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fffdf7] p-1.5"><img src="/logo.svg" alt="GEEBLI" className="h-full w-full object-contain"/></span><span><b className="block text-base tracking-wide">GEEBLI</b><span className="text-[11px] text-[#c9d9ce]">مركز إدارة المنصة</span></span></Link>
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-[#e2ece4]"><span className="h-2 w-2 rounded-full bg-[#e8a477]"/><span>لوحة الإدارة</span></div>
      </div>
    </header>
    <div className="shell grid gap-6 py-6 md:grid-cols-[245px_minmax(0,1fr)] md:gap-8 md:py-9">
      <aside className="h-fit rounded-[26px] border border-[#e1e7dd] bg-white/90 p-4 shadow-[0_14px_38px_rgba(37,68,50,.06)] md:sticky md:top-[100px]">
        <div className="mb-4 rounded-2xl bg-[#f1f4ed] p-4"><p className="m-0 text-[11px] font-bold tracking-widest text-[#8b9a8b]">مساحة العمل</p><p className="mb-0 mt-1 text-lg font-extrabold text-[#21483d]">إدارة جيبلي</p></div>
        <nav className="grid grid-cols-2 gap-2 md:grid-cols-1">{links.map(item=><Link key={item.href} href={item.href} className={"flex items-center gap-3 rounded-2xl px-3 py-3 text-xs font-semibold no-underline transition md:text-sm " + (active===item.href ? "bg-[#17483e] text-white shadow-[0_8px_18px_rgba(23,72,62,.18)]" : "text-[#52665c] hover:bg-[#eef2eb]")}><span className={active===item.href?"text-[#f2bd92]":"text-[#6d8a78]"}>{item.icon}</span><span>{item.label}</span></Link>)}</nav>
        <div className="mt-5 rounded-2xl border border-[#e7e8dc] bg-[#faf9f3] p-3"><p className="m-0 text-xs font-bold text-[#345b4b]">تنبيه إداري</p><p className="mb-0 mt-1 text-[11px] leading-6 text-[#7a8579]">راجع إيصالات الاشتراك قبل اعتمادها. تبقى سجلات الدفع محفوظة للمراجعة.</p></div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  </div>;
}
function AdminHome() { const summary=useGetAdminSummary(); const sellers=useListAdminSellers(); const orders=useListAdminOrders(); return <AdminLayout active="/admin"><p className="text-xs font-bold tracking-widest text-[#a96f4f]">ملخص المنصة</p><h1 className="serif mt-1 text-3xl font-extrabold">نظرة عامة</h1>{summary.isLoading?<div className="grid gap-4 sm:grid-cols-3">{[1,2,3,4,5,6].map(x=><div key={x} className="h-28 animate-pulse rounded-2xl bg-muted"/>)}</div>:summary.isError?<Retry text="تعذّر تحميل الملخص" onRetry={()=>summary.refetch()}/>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Metric label="إجمالي البائعين" value={summary.data?.totalSellers??0} icon={<Store/>}/><Metric label="طلبات بائعين قيد المراجعة" value={summary.data?.pendingSellers??0} icon={<Clock3/>}/><Metric label="المنتجات النشطة" value={summary.data?.totalProducts??0} icon={<Box/>}/><Metric label="إجمالي الطلبات" value={summary.data?.totalOrders??0} icon={<ShoppingBag/>}/><Metric label="طلبات مفتوحة" value={summary.data?.openOrders??0} icon={<Truck/>}/><Metric label="إجمالي المبيعات" value={money(summary.data?.revenue??0)} icon={<Check/>}/></div>}<div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-lg font-bold">أحدث الطلبات</h2><Link href="/admin/orders" className="text-sm font-bold text-[#2b6756] no-underline">كل الطلبات ←</Link></div>{orders.isLoading?<div className="h-40 animate-pulse rounded-2xl bg-muted"/>:orders.isError?<Retry text="تعذّر تحميل الطلبات" onRetry={()=>orders.refetch()}/>:<OrdersTable orders={(orders.data??[]).slice(0,5)}/>}<div className="mt-8 flex items-center justify-between"><h2 className="m-0 text-lg font-bold">طلبات انضمام حديثة</h2><Link href="/admin/sellers" className="text-sm font-bold text-[#2b6756] no-underline">مراجعة ←</Link></div><SellerApprovalList sellers={(sellers.data??[]).filter(s=>s.status==='pending').slice(0,3)}/></AdminLayout>; }
function SellerApprovalList({sellers}:{sellers:Seller[]}) { const decision=useDecideSellerApplication();const qc=useQueryClient();const refresh=()=>{qc.invalidateQueries({queryKey:getListAdminSellersQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});}; return sellers.length?<div className="mt-4 grid gap-3">{sellers.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4"><div><div className="font-bold">{s.storeName}</div><div className="mt-1 text-xs text-muted-foreground">{s.contactName} · {s.phone} · {s.email}</div></div><div className="flex gap-2"><button className="btn btn-primary !px-4 !py-2 text-xs" disabled={decision.isPending} onClick={()=>decision.mutate({id:s.id,data:{status:'approved'}},{onSuccess:refresh})}>اعتماد</button><button className="btn !bg-[#f3dfd8] !px-4 !py-2 text-xs text-[#8b4235]" disabled={decision.isPending} onClick={()=>decision.mutate({id:s.id,data:{status:'rejected'}},{onSuccess:refresh})}>رفض</button></div></div>)}</div>:<p className="mt-3 rounded-2xl border border-dashed p-7 text-center text-sm text-muted-foreground">لا توجد طلبات بائعين بانتظار المراجعة.</p>; }
function AdminSellers() { const q=useListAdminSellers(); return <AdminLayout active="/admin/sellers"><p className="text-xs font-bold tracking-widest text-[#a96f4f]">مراجعة يدوية</p><h1 className="serif mt-1 text-3xl font-extrabold">طلبات البائعين</h1>{q.isLoading?<div className="h-40 animate-pulse rounded-2xl bg-muted"/>:q.isError?<Retry text="تعذّر تحميل طلبات البائعين" onRetry={()=>q.refetch()}/>:<><SellerApprovalList sellers={(q.data??[]).filter(s=>s.status==='pending')}/><h2 className="mt-9 text-lg font-bold">كل البائعين</h2><div className="table-wrap mt-4"><table><thead><tr><th>المتجر</th><th>جهة التواصل</th><th>رقم الجوال</th><th>البريد الإلكتروني</th><th>الحالة</th></tr></thead><tbody>{(q.data??[]).map(s=><tr key={s.id}><td className="font-semibold">{s.storeName}</td><td>{s.contactName}</td><td dir="ltr" className="text-right">{s.phone}</td><td dir="ltr" className="text-right">{s.email}</td><td><span className="status">{statuses[s.status]}</span></td></tr>)}</tbody></table></div></>}</AdminLayout>; }
function AdminOrders() { const q=useListAdminOrders(); return <AdminLayout active="/admin/orders"><p className="text-xs font-bold tracking-widest text-[#a96f4f]">تنسيق الشحن</p><h1 className="serif mt-1 text-3xl font-extrabold">إدارة الطلبات</h1><p className="text-sm text-muted-foreground">تابع حالة الطلبات التي يديرها البائعون، دون تعديلها من لوحة الإدارة.</p>{q.isLoading?<div className="h-48 animate-pulse rounded-2xl bg-muted"/>:q.isError?<Retry text="تعذّر تحميل الطلبات" onRetry={()=>q.refetch()}/>:q.data?.length?<OrdersTable orders={q.data}/>:<EmptyState title="لا توجد طلبات بعد" text="ستظهر طلبات العملاء هنا."/>}</AdminLayout>; }

function Router() {
  const [location] = useLocation();
  const cart=useCart();
  useEffect(()=>{document.documentElement.lang='ar';document.documentElement.dir='rtl';document.title='جيبلي | اكتشف منتجات محلية';},[]);
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/"><Home cart={cart}/></Route>
    <Route path="/shop"><ShopPage cart={cart}/></Route>
    <Route path="/contact" component={ContactPage}/>
    <Route path="/product/:id"><ProductPage cart={cart}/></Route>
    <Route path="/checkout"><Checkout cart={cart}/></Route>
    <Route path="/order-confirmed/:code" component={OrderConfirmed}/>
    <Route path="/my-orders" component={MyOrdersPage}/>
    <Route path="/chat" component={GuestChat}/>
    <Route path="/sign-in/*?"><AuthPage mode="sign-in"/></Route>
    <Route path="/sign-up/*?"><AuthPage mode="sign-up"/></Route>
    <Route path="/seller" component={SellerPage}/>
    <Route path="/seller/dashboard" component={SellerDashboard}/>
    <Route path="/seller/products" component={SellerProducts}/>
    <Route path="/seller/products/new" component={NewProduct}/>
    <Route path="/seller/orders" component={SellerOrders}/>
    <Route path="/seller/subscription" component={SellerSubscription}/>
    <Route path="/seller/chats" component={SellerChats}/>
    <Route path="/seller/chats/:id" component={SellerChats}/>
    <Route path="/admin" component={AdminHome}/>
    <Route path="/admin/sellers" component={AdminSellers}/>
    <Route path="/admin/orders" component={AdminOrders}/>
    <Route path="/admin/subscriptions" component={AdminSubscriptions}/>
    <Route component={NotFound}/>
  </Switch></ErrorBoundary>;
}
function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) client.clear();
    previousUserId.current = userId;
  }), [addListener, client]);
  return null;
}

function ClerkRoutingProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{ theme: shadcn, cssLayerName: 'clerk' }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={arSA} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><ClerkQueryCacheInvalidator/>{children}</ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutingProvider><Router/></ClerkRoutingProvider></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;