<script setup lang="ts">
import { loadSharedBanners, uploadSharedBanner } from '~/composables/useSharedSettings';

const uploadError = ref('');
const uploading = ref(false);
// 横型バナー宣伝画像の表示の切り替え
const bannerVisible = isBannerVisible();
// 横バナーのソース
const banner = bannerSource();
// 縦型バナー宣伝画像の表示の切り替え
const verticalBannerVisible = isVerticalBanner();
// 縦バナーのソース
const verticalBanner = verticalBannerSource();

// バナー画像のアップロード時の処理
const onBannerUpload = async (e: Event) => {
  if (!(e.target instanceof HTMLInputElement)) return;
  const file = e.target.files?.[0];
  if (!file) return;

  uploadError.value = '';
  uploading.value = true;
  try {
    await uploadSharedBanner('horizontal', file);
    banner.value = (await loadSharedBanners()).horizontal?.url ?? null;
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : 'バナー画像を保存できませんでした';
  } finally {
    uploading.value = false;
  }
}

const onVerticalBannerUpload = async (e: Event) => {
  if (!(e.target instanceof HTMLInputElement)) return;
  const file = e.target.files?.[0];
  if (!file) return;

  uploadError.value = '';
  uploading.value = true;
  try {
    await uploadSharedBanner('vertical', file);
    verticalBanner.value = (await loadSharedBanners()).vertical?.url ?? null;
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : 'バナー画像を保存できませんでした';
  } finally {
    uploading.value = false;
  }
}
</script>
<template>
  <label class="label cursor-pointer">
    <span class="label-text">横型バナー宣伝画像の有効化</span>
    <input type="checkbox" class="toggle toggle-secondary" v-model="bannerVisible" />
  </label>
  <label v-if="bannerVisible" class="form-control w-full">
    <div class="label">
      <span class="label-text"> 17:3(1700x300)サイズの画像を推奨</span>
    </div>
    <input type="file" accept="image/*" class="file-input file-input-bordered file-input-sm w-full"
      :disabled="uploading" @change="onBannerUpload" />
  </label>

  <label class="label cursor-pointer mt-3">
    <span class="label-text">
      縦型バナー宣伝画像の有効化
      <br>
      (イベントカウントダウンの部分に表示されます)
    </span>
    <input type="checkbox" class="toggle toggle-secondary" v-model="verticalBannerVisible" />
  </label>
  <label v-if="verticalBannerVisible" class="form-control w-full">
    <div class="label">
      <span class="label-text"> 23:40(920x1600)サイズの画像を推奨</span>
    </div>
    <input type="file" accept="image/*" class="file-input file-input-bordered file-input-sm w-full"
      :disabled="uploading" @change="onVerticalBannerUpload" />
  </label>
  <p v-if="uploadError" class="text-error text-sm" role="alert">{{ uploadError }}</p>
</template>
