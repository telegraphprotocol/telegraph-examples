#![no_std]
use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const HEAP_SIZE: usize = 1 * 1024 * 1024;
static mut HEAP: [u8; HEAP_SIZE] = [0u8; HEAP_SIZE];
static mut HEAP_OFFSET: usize = 0;

#[unsafe(no_mangle)]
pub unsafe extern "C" fn alloc(size: i32) -> i32 {
    let size = size.max(0) as usize;
    unsafe {
        let aligned = (HEAP_OFFSET + 3) & !3;
        if aligned + size > HEAP_SIZE {
            HEAP_OFFSET = 0;
        } else {
            HEAP_OFFSET = aligned;
        }
        let ptr = core::ptr::addr_of_mut!(HEAP).cast::<u8>().add(HEAP_OFFSET);
        HEAP_OFFSET += size;
        ptr as i32
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(_ptr: i32, _size: i32) {}

unsafe fn read_str<'a>(ptr: i32, len: i32) -> &'a str {
    unsafe {
        let slice = core::slice::from_raw_parts(ptr as *const u8, len.max(0) as usize);
        core::str::from_utf8_unchecked(slice)
    }
}

fn word_overlap(answer: &str, ground_truth: &str) -> f32 {
    let mut total = 0u32;
    let mut matched = 0u32;
    for word in answer.split_whitespace() {
        total += 1;
        if ground_truth
            .split_whitespace()
            .any(|w| w.eq_ignore_ascii_case(word))
        {
            matched += 1;
        }
    }
    if total == 0 {
        0.0
    } else {
        matched as f32 / total as f32
    }
}

fn score(ground_truth: &str, miner_answer: &str) -> f32 {
    if miner_answer == ground_truth {
        return 1.0;
    }
    word_overlap(miner_answer, ground_truth)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rank_answer(
    _q_ptr: i32,
    _q_len: i32,
    gt_ptr: i32,
    gt_len: i32,
    ma_ptr: i32,
    ma_len: i32,
) -> f32 {
    unsafe {
        let ground_truth = read_str(gt_ptr, gt_len);
        let miner_answer = read_str(ma_ptr, ma_len);
        if miner_answer.trim().is_empty() {
            return 0.0;
        }
        score(ground_truth, miner_answer)
    }
}
