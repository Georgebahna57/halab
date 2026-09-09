# صناديق

## الإعداد (مرة واحدة)

### 1. أنشئ مشروع على [Supabase](https://supabase.com)

### 2. شغّل السكربت
من **SQL Editor** انسخ وشغّل محتوى `supabase/schema.sql`

### 3. انسخ المفاتيح من لوحة Supabase

**المسار الحالي (2025+):**
1. ادخل [supabase.com/dashboard](https://supabase.com/dashboard)
2. اختر مشروعك
3. من الشريط الجانبي الأيسر: **⚙️ Project Settings** (إعدادات المشروع)
4. اختر **API Keys** (مش "API" القديمة)
5. انسخ:
   - **Project URL** — من أعلى الصفحة أو تبويب Legacy
   - **anon public** أو **Publishable key** — للتطبيق

**إذا ما لقيت API Keys:**
- جرّب زر **Connect** من الصفحة الرئيسية للمشروع
- أو **Home** → قسم **Project API** → **API Keys**

```bash
cp .env.example .env
```

عبّي الملف:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   أو sb_publishable_...
```

### 4. عطّل التسجيل الذاتي في Supabase
Authentication → **Sign In / Providers** → Email → **أوقف Enable Sign Ups**

### 5. أضف المستخدمين يدوياً
Authentication → **Users** → **Add user** → Create new user
- حط الإيميل وكلمة السر لكل موظف
- كرّر لكل شخص بدك ياه يدخل

### 6. (اختياري) عطّل تأكيد الإيميل
Authentication → Providers → Email → أوقف "Confirm email"

## التشغيل

```bash
npm install
npm run dev
```

يفتح على `http://localhost:3001`

## الصناديق (نقدية)

كل صندوق يدعم **جميع العملات** (دولار، يورو، سوري، ذهب، فضة، وغيرها):

- **ستيل ماكس**
- **جورج ابو عيون**
- **موني آوت**
- **حلب الجديدة**

## الحسابات (قسم منفصل)

- **مراكز** — حسابات المراكز والمطابقات (ليست صندوقاً نقدياً)
- **زبائن** — حسابات الزبائن لكل صندوق نقدي

## الميزات

- تسجيل دخول + بيانات سحابية
- صندوق منفصل + حسابات زبائن لكل صندوق
- ربط حركة الصندوق مع حساب الزبون بعملية واحدة
- عملية واحدة بعدة عملات / ذهب
- فلترة وبحث بالعمليات (تاريخ، طرف، عملة)
- تعديل العمليات (مسؤول) مع سجل من عدّل ومتى
- حذف العمليات — مسؤول فقط
- قيد انتظار، فواتير، صلاحيات

## الصلاحيات

شغّل `supabase/permissions.sql` من SQL Editor بعد `schema.sql`

### تعيين أول مسؤول
بعد أول تسجيل دخول، من SQL Editor:
```sql
update profiles set is_admin = true where email = 'YOUR_EMAIL@example.com';
```

### صلاحيات الصناديق
| الصلاحية | المعنى |
|---|---|
| **تعديل** | إدخال وحذف واعتماد |
| **مراجعة** | مشاهدة فقط |
| **مخفي** | ما بيظهر أصلاً |

من التطبيق: زر **إدارة** (للمسؤول فقط) → حدد صلاحيات كل مستخدم

### تحديث قاعدة البيانات
شغّل `supabase/migrate-all.sql` بعد التحديثات الجديدة (ربط حسابات، سجل تعديل، إلخ)

## النشر على Vercel (رابط ثابت)

### 1. ارفع المشروع على GitHub
```bash
git init
git add .
git commit -m "صناديق"
git remote add origin https://github.com/YOUR_USER/sandouk-nemr.git
git push -u origin main
```

### 2. انشر على [vercel.com](https://vercel.com)
1. سجّل دخول → **Add New Project** → اختر المستودع
2. Framework: **Vite** (يكتشف تلقائياً)
3. **Environment Variables** — أضف:
   - `VITE_SUPABASE_URL` = رابط مشروعك
   - `VITE_SUPABASE_ANON_KEY` = المفتاح العام
4. اضغط **Deploy**

بعد الدقيقة بتحصل رابط مثل: `https://sandouk-nemr.vercel.app`

### 3. Supabase — سمّح بالرابط الجديد
Authentication → URL Configuration → **Site URL** = رابط Vercel
**Redirect URLs** = `https://your-app.vercel.app/**`

### بديل: Netlify
نفس الفكرة — اربط GitHub، Build: `npm run build`، Publish: `dist`

### إضافة مستخدم
Supabase → Authentication → Users → Add user (التسجيل الذاتي معطّل)
