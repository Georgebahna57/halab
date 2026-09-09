# إعداد حلب — خطوة بخطوة

أنت أنجزت **الخطوة 1** (`schema.sql`). اتبع الباقي بالترتيب.

---

## الخطوة 2 — باقي سكربتات Supabase

افتح مشروعك في [supabase.com/dashboard](https://supabase.com/dashboard) → **SQL Editor** → **New query**

شغّل كل ملف **بالترتيب** (انسخ المحتوى كامل → Run):

| # | الملف | لماذا |
|---|---|---|
| 1 | `supabase/schema.sql` | ✅ أنجزته |
| 2 | `supabase/permissions.sql` | المستخدمين والصلاحيات |
| 3 | `supabase/migrate-all.sql` | أعمدة إضافية + إعدادات الصناديق |
| 4 | `supabase/accounts-only-audit.sql` | سجل التدقيق |
| 5 | `supabase/edit-past-permission.sql` | صلاحية تعديل الحركات القديمة |
| 6 | `supabase/daily-backups.sql` | (اختياري) نسخ احتياطي يومي |

> إذا ظهر خطأ «عمود ناقص» لاحقاً، شغّل أيضاً `supabase/add-missing-tx-columns.sql`

---

## الخطوة 3 — مفاتيح Supabase في المشروع

1. Supabase → **Project Settings** → **API Keys**
2. انسخ:
   - **Project URL**
   - **anon public** (أو Publishable key)

3. في مجلد المشروع أنشئ ملف `.env`:

```bash
cp .env.example .env
```

4. عدّل `.env`:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...   أو sb_publishable_...
```

> **مهم:** لا ترفع `.env` على GitHub — موجود في `.gitignore`

---

## الخطوة 4 — إعداد تسجيل الدخول

في Supabase → **Authentication**:

### 4.1 عطّل التسجيل الذاتي
**Providers** → **Email** → أوقف **Enable Sign Ups**

### 4.2 (مُستحسن) عطّل تأكيد الإيميل
**Providers** → **Email** → أوقف **Confirm email**

### 4.3 أضف مستخدم
**Users** → **Add user** → **Create new user**
- حط الإيميل وكلمة السر (مثلاً حسابك أنت كمسؤول)

---

## الخطوة 5 — تعيين أول مسؤول

بعد إضافة المستخدم، من **SQL Editor** شغّل (غيّر الإيميل):

```sql
update profiles set is_admin = true where email = 'YOUR_EMAIL@example.com';
```

> إذا ما ظهر سطر في `profiles`، سجّل دخول مرة من التطبيق أولاً ثم أعد تشغيل الأمر.

---

## الخطوة 6 — تشغيل التطبيق

```bash
npm install
npm run dev
```

افتح: **http://localhost:3001**

سجّل دخول بالإيميل وكلمة السر اللي أنشأتهم في Supabase.

---

## الخطوة 7 — (لاحقاً) النشر على Vercel

1. ارفع المشروع على GitHub
2. [vercel.com](https://vercel.com) → New Project → اختر المستودع
3. أضف نفس متغيرات `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy

5. في Supabase → **Authentication** → **URL Configuration**:
   - **Site URL** = رابط Vercel
   - **Redirect URLs** = `https://your-app.vercel.app/**`

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| شاشة فارغة / لا يتصل | تأكد من `.env` والمفاتيح صح |
| «فشل تسجيل الدخول» | تأكد المستخدم موجود + Confirm email معطّل |
| «فشل الحفظ» | شغّل `migrate-all.sql` |
| لا أرى زر الإدارة | شغّل أمر `update profiles set is_admin = true...` |
| لا أرى صناديق | المسؤول يرى الكل — غير المسؤول يحتاج صلاحيات من الإدارة |

---

## ملخص سريع (3 دقائق)

```
schema.sql ✅
→ permissions.sql
→ migrate-all.sql
→ accounts-only-audit.sql
→ edit-past-permission.sql
→ .env بالمفاتيح
→ Add user في Supabase
→ is_admin = true
→ npm install && npm run dev
```
