/*

Opcode ref
http://ref.x86asm.net/coder32.html#xC4

http://en.wikibooks.org/wiki/X86_Assembly/X86_Architecture

http://en.wikipedia.org/wiki/X86
http://en.wikipedia.org/wiki/Control_register
http://en.wikipedia.org/wiki/X86_assembly_language

http://en.wikipedia.org/wiki/Translation_lookaside_buffer

http://bellard.org/jslinux/tech.html

===================================================================================================
CPU Emulation

Some of the code is inspired from my x86 dynamic translator present in QEMU, but there are important differences because here it is an interpreter. The CPU is close to a 486 compatible x86 without FPU. The lack of FPU is not a problem when running Linux as Operating System because it contains a FPU emulator. In order to be able to run Linux, a complete MMU is implemented. The exact restrictions of the emulated CPU are:
No FPU/MMX/SSE
No segment limit and right checks when accessing memory (Linux does not rely on them for memory protection, so it is not an issue. The x86 emulator of QEMU has the same restriction).
No single-stepping
I added some tricks which are not present in QEMU to be more precise when emulating unaligned load/stores at page boundaries. The condition code emulation is also more efficient than the one in QEMU.

===================================================================================================

Devices

Currently there is no synchronization between the PIT frequency and the real time, so there is a variable drift between the time returned by Linux (try the "date" command) and the real time.
The UART (serial port) does not support FIFO mode. Perhaps it could help to improve the display speed.

There is no network emulation at this point.

A clipboard device (seen as /dev/clipboard in the emulator) was added to allow exchange of data between the emulator and the outside world.



Javascript terminal

Although I could have reused the excellent termlib, I decided to write my own because I was curious to see how it could be done. The main problem is the key handling which is different among browsers and OSes, as described here.
Linux distribution



I compiled a 2.6.20 Linux kernel (I guess any other version would work provided there is still an FPU emulator). The Linux kernel configuration, patch and the source code of the Linux starter (kind of BIOS) are available: linuxstart-20110820.tar.gz.
The disk image is just a ram disk image loaded at boot time. It contains a filesystem generated with Buildroot containing BusyBox. I added my toy C compiler TinyCC and my unfinished but usable emacs clone QEmacs. There is also a small MS-DOS .COM launcher I use to test the 16 bit emulation with a tiny .COM program to compute pi and a small self-assembling assembler for MS-DOS.


X & -65281  = mask for lower 8 bits for 32bit X
X & 3       = mask for lower 2 bits for single byte X


*/
var parity_bit_check_array = [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];
var used_by_shift16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
var used_by_shift8 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4];

function CPU_X86() {
    var i, tlb_size;
    /*
      AX/EAX/RAX: Accumulator
      BX/EBX/RBX: Base index (for use with arrays)
      CX/ECX/RCX: Counter
      DX/EDX/RDX: Data/general
      SI/ESI/RSI: Source index for string operations.
      DI/EDI/RDI: Destination index for string operations.
      SP/ESP/RSP: Stack pointer for top address of the stack.
      BP/EBP/RBP: Stack base pointer for holding the address of the current stack frame.

      (((IP/EIP/RIP: Instruction pointer. Holds the program counter, the current instruction address.)))-->handled separately in "this.eip"
    */
    this.regs = new Array(); // EAX, EBX, ECX, EDX, ESI, EDI, ESP, EBP  32bit registers
    for (i = 0; i < 8; i++) {
        this.regs[i] = 0;
    }
    this.eip         = 0; //instruction pointer
    this.cc_op       = 0; // current op
    this.cc_dst      = 0; // current dest
    this.cc_src      = 0; // current src
    this.cc_op2      = 0; // current op, byte2
    this.cc_dst2     = 0; // current dest, byte2
    this.df          = 1;

    /*
      0.    CF : Carry Flag. Set if the last arithmetic operation carried (addition) or borrowed (subtraction) a
                 bit beyond the size of the register. This is then checked when the operation is followed with
                 an add-with-carry or subtract-with-borrow to deal with values too large for just one register to contain.
      2.    PF : Parity Flag. Set if the number of set bits in the least significant byte is a multiple of 2.
      4.    AF : Adjust Flag. Carry of Binary Code Decimal (BCD) numbers arithmetic operations.
      6.    ZF : Zero Flag. Set if the result of an operation is Zero (0).
      7.    SF : Sign Flag. Set if the result of an operation is negative.
      8.    TF : Trap Flag. Set if step by step debugging.
      9.    IF : Interruption Flag. Set if interrupts are enabled.
      10.   DF : Direction Flag. Stream direction. If set, string operations will decrement their pointer rather
                 than incrementing it, reading memory backwards.
      11.   OF : Overflow Flag. Set if signed arithmetic operations result in a value too large for the register to contain.
      12-13. IOPL : I/O Privilege Level field (2 bits). I/O Privilege Level of the current process.
      14.   NT : Nested Task flag. Controls chaining of interrupts. Set if the current process is linked to the next process.
      16.   RF : Resume Flag. Response to debug exceptions.
      17.   VM : Virtual-8086 Mode. Set if in 8086 compatibility mode.
      18.   AC : Alignment Check. Set if alignment checking of memory references is done.
      19.   VIF : Virtual Interrupt Flag. Virtual image of IF.
      20.   VIP : Virtual Interrupt Pending flag. Set if an interrupt is pending.
      21.   ID : Identification Flag. Support for CPUID instruction if can be set.
    */
    this.eflags      = 0x2; // EFLAG register

    this.cycle_count = 0;
    this.hard_irq    = 0;
    this.hard_intno  = -1;
    this.cpl         = 0; //cpu privilege level

    /*
       Control Registers
       ==========================================================================================
    */
    /*
      31    PG  Paging             If 1, enable paging and use the CR3 register, else disable paging
      30    CD  Cache disable      Globally enables/disable the memory cache
      29    NW  Not-write through  Globally enables/disable write-back caching
      18    AM  Alignment mask     Alignment check enabled if AM set, AC flag (in EFLAGS register) set, and privilege level is 3
      16    WP  Write protect      Determines whether the CPU can write to pages marked read-only
      5     NE  Numeric error      Enable internal x87 floating point error reporting when set, else enables PC style x87 error detection
      4     ET  Extension type     On the 386, it allowed to specify whether the external math coprocessor was an 80287 or 80387
      3     TS  Task switched      Allows saving x87 task context only after x87 instruction used after task switch
      2     EM  Emulation          If set, no x87 floating point unit present, if clear, x87 FPU present
      1     MP  Monitor co-processor   Controls interaction of WAIT/FWAIT instructions with TS flag in CR0
      0     PE  Protected Mode Enable  If 1, system is in protected mode, else system is in real mode
    */
    this.cr0         = (1 << 0); //control register 0:

    /* CR2
       Page Fault Linear Address (PFLA) When a page fault occurs,
       the address the program attempted to access is stored in the
       CR2 register. */
    this.cr2         = 0; // control register 2

    /* CR3
       Used when virtual addressing is enabled, hence when the PG
       bit is set in CR0.  CR3 enables the processor to translate
       virtual addresses into physical addresses by locating the page
       directory and page tables for the current task. Typically, the
       upper 20 bits of CR3 become the page directory base register
       (PDBR), which stores the physical address of the first page
       directory entry.  */
    this.cr3         = 0; // control register 3:

    /* CR4
       Used in protected mode to control operations such as virtual-8086 support, enabling I/O breakpoints,
       page size extension and machine check exceptions.
       Bit  Name    Full Name   Description
       18   OSXSAVE XSAVE and Processor Extended States Enable
       17   PCIDE   PCID Enable If set, enables process-context identifiers (PCIDs).
       14   SMXE    SMX Enable
       13   VMXE    VMX Enable
       10   OSXMMEXCPT  Operating System Support for Unmasked SIMD Floating-Point Exceptions    If set, enables unmasked SSE exceptions.
       9    OSFXSR  Operating system support for FXSAVE and FXSTOR instructions If set, enables SSE instructions and fast FPU save & restore
       8    PCE Performance-Monitoring Counter enable
              If set, RDPMC can be executed at any privilege level, else RDPMC can only be used in ring 0.
       7    PGE Page Global Enabled If set, address translations (PDE or PTE records) may be shared between address spaces.
       6    MCE Machine Check Exception If set, enables machine check interrupts to occur.
       5    PAE Physical Address Extension
              If set, changes page table layout to translate 32-bit virtual addresses into extended 36-bit physical addresses.
       4    PSE Page Size Extensions    If unset, page size is 4 KB, else page size is increased to 4 MB (ignored with PAE set).
       3    DE  Debugging Extensions
       2    TSD Time Stamp Disable
              If set, RDTSC instruction can only be executed when in ring 0, otherwise RDTSC can be used at any privilege level.
       1    PVI Protected-mode Virtual Interrupts   If set, enables support for the virtual interrupt flag (VIF) in protected mode.
       0    VME Virtual 8086 Mode Extensions    If set, enables support for the virtual interrupt flag (VIF) in virtual-8086 mode.
     */
    this.cr4         = 0; // control register 4


    /*
      Segment registers:
      ES: Extra
      CS: Code
      SS: Stack
      DS: Data
      FS: Extra
      GS: Extra
      (and in this VM,
      LDT
      TR
      )
      Fun facts, these are rarely used in the wild due to nearly exclusive use of paging in protected and long mode.
      However, chrome's Native Client uses them to sandbox native code memory access.
    */
    this.segs = new Array();   //   [" ES", " CS", " SS", " DS", " FS", " GS", "LDT", " TR"]
    for (i = 0; i < 7; i++) {
        this.segs[i] = {selector: 0, base: 0, limit: 0, flags: 0};
    }
    this.segs[2].flags = (1 << 22);
    this.segs[1].flags = (1 << 22);

    // descriptor registers (GDTR, LDTR, IDTR) ?
    this.idt         = {base: 0, limit: 0};
    this.gdt         = {base: 0, limit: 0};
    this.ldt = {selector: 0, base: 0, limit: 0, flags: 0};

    //task register?
    this.tr  = {selector: 0, base: 0, limit: 0, flags: 0};

    this.halted = 0;
    this.phys_mem = null;

    /*
       A translation lookaside buffer (TLB) is a CPU cache that memory
       management hardware uses to improve virtual address translation
       speed.

       A TLB has a fixed number of slots that contain page table
       entries, which map virtual addresses to physical addresses. The
       virtual memory is the space seen from a process. This space is
       segmented in pages of a prefixed size. The page table
       (generally loaded in memory) keeps track of where the virtual
       pages are loaded in the physical memory. The TLB is a cache of
       the page table; that is, only a subset of its content are
       stored.
     */

    tlb_size = 0x100000; //1e6*4096 ~= 4GB total memory possible?
    this.tlb_read_kernel  = new Int32Array(tlb_size);
    this.tlb_write_kernel = new Int32Array(tlb_size);
    this.tlb_read_user    = new Int32Array(tlb_size);
    this.tlb_write_user   = new Int32Array(tlb_size);
    for (i = 0; i < tlb_size; i++) {
        this.tlb_read_kernel[i]  = -1;
        this.tlb_write_kernel[i] = -1;
        this.tlb_read_user[i]    = -1;
        this.tlb_write_user[i]   = -1;
    }
    this.tlb_pages = new Int32Array(2048);
    this.tlb_pages_count = 0;
}
/* Allocates a memory chunnk new_mem_size bytes long and makes 8,16,32 bit array references into it */
CPU_X86.prototype.phys_mem_resize = function(new_mem_size) {
    this.mem_size = new_mem_size;
    new_mem_size += ((15 + 3) & ~3);
    this.phys_mem   = new ArrayBuffer(new_mem_size);
    this.phys_mem8  = new Uint8Array(this.phys_mem, 0, new_mem_size);
    this.phys_mem16 = new Uint16Array(this.phys_mem, 0, new_mem_size / 2);
    this.phys_mem32 = new Int32Array(this.phys_mem, 0, new_mem_size / 4);
};

CPU_X86.prototype.ld8_phys = function(mem8_loc) {      return this.phys_mem8[mem8_loc]; };
CPU_X86.prototype.st8_phys = function(mem8_loc, x) {         this.phys_mem8[mem8_loc] = x; };
CPU_X86.prototype.ld32_phys = function(mem8_loc) {     return this.phys_mem32[mem8_loc >> 2]; };
CPU_X86.prototype.st32_phys = function(mem8_loc, x) {        this.phys_mem32[mem8_loc >> 2] = x; };

CPU_X86.prototype.tlb_set_page = function(mem8_loc, ha, ia, ja) {
    var i, x, j;
    ha &= -4096;
    mem8_loc &= -4096;
    x = mem8_loc ^ ha;
    i = mem8_loc >>> 12;
    if (this.tlb_read_kernel[i] == -1) {
        if (this.tlb_pages_count >= 2048) {
            this.tlb_flush_all1((i - 1) & 0xfffff);
        }
        this.tlb_pages[this.tlb_pages_count++] = i;
    }
    this.tlb_read_kernel[i] = x;
    if (ia) {
        this.tlb_write_kernel[i] = x;
    } else {
        this.tlb_write_kernel[i] = -1;
    }
    if (ja) {
        this.tlb_read_user[i] = x;
        if (ia) {
            this.tlb_write_user[i] = x;
        } else {
            this.tlb_write_user[i] = -1;
        }
    } else {
        this.tlb_read_user[i] = -1;
        this.tlb_write_user[i] = -1;
    }
};

CPU_X86.prototype.tlb_flush_page = function(mem8_loc) {
    var i;
    i = mem8_loc >>> 12;
    this.tlb_read_kernel[i] = -1;
    this.tlb_write_kernel[i] = -1;
    this.tlb_read_user[i] = -1;
    this.tlb_write_user[i] = -1;
};

CPU_X86.prototype.tlb_flush_all = function() {
    var i, j, n, ka;
    ka = this.tlb_pages;
    n = this.tlb_pages_count;
    for (j = 0; j < n; j++) {
        i = ka[j];
        this.tlb_read_kernel[i] = -1;
        this.tlb_write_kernel[i] = -1;
        this.tlb_read_user[i] = -1;
        this.tlb_write_user[i] = -1;
    }
    this.tlb_pages_count = 0;
};

CPU_X86.prototype.tlb_flush_all1 = function(la) {
    var i, j, n, ka, ma;
    ka = this.tlb_pages;
    n = this.tlb_pages_count;
    ma = 0;
    for (j = 0; j < n; j++) {
        i = ka[j];
        if (i == la) {
            ka[ma++] = i;
        } else {
            this.tlb_read_kernel[i] = -1;
            this.tlb_write_kernel[i] = -1;
            this.tlb_read_user[i] = -1;
            this.tlb_write_user[i] = -1;
        }
    }
    this.tlb_pages_count = ma;
};

/* writes ASCII string in na into memory location mem8_loc */
CPU_X86.prototype.write_string = function(mem8_loc, na) {
    var i;
    for (i = 0; i < na.length; i++) {
        this.st8_phys(mem8_loc++, na.charCodeAt(i) & 0xff);
    }
    this.st8_phys(mem8_loc, 0);
};

// Represents numeric value ga as n-digit HEX
function hex_rep(x, n) {
    var i, s;
    var h = "0123456789ABCDEF";
    s = "";
    for (i = n - 1; i >= 0; i--) {
        s = s + h[(x >>> (i * 4)) & 15];
    }
    return s;
}

function _4_bytes_(n) { return hex_rep(n, 8);} // Represents 8-hex bytes of n
function _2_bytes_(n) { return hex_rep(n, 2);} // Represents 4-hex bytes of n
function _1_byte_(n) { return hex_rep(n, 4);}  // Represents 2-hex bytes of n

CPU_X86.prototype.dump_short = function() {
    console.log(" EIP=" + _4_bytes_(this.eip)    + " EAX=" + _4_bytes_(this.regs[0])
                + " ECX=" + _4_bytes_(this.regs[1]) + " EDX=" + _4_bytes_(this.regs[2]) + " EBX=" + _4_bytes_(this.regs[3]));
    console.log(" EFL=" + _4_bytes_(this.eflags) + " ESP=" + _4_bytes_(this.regs[4])
                + " EBP=" + _4_bytes_(this.regs[5]) + " ESI=" + _4_bytes_(this.regs[6]) + " EDI=" + _4_bytes_(this.regs[7]));
};

CPU_X86.prototype.dump = function() {
    var i, sa, na;
    var ta = [" ES", " CS", " SS", " DS", " FS", " GS", "LDT", " TR"];
    this.dump_short();
    console.log("TSC=" + _4_bytes_(this.cycle_count) + " OP=" + _2_bytes_(this.cc_op)
                + " SRC=" + _4_bytes_(this.cc_src) + " DST=" + _4_bytes_(this.cc_dst)
                + " OP2=" + _2_bytes_(this.cc_op2) + " DST2=" + _4_bytes_(this.cc_dst2));
    console.log("CPL=" + this.cpl + " CR0=" + _4_bytes_(this.cr0)
                + " CR2=" + _4_bytes_(this.cr2) + " CR3=" + _4_bytes_(this.cr3) + " CR4=" + _4_bytes_(this.cr4));
    na = "";
    for (i = 0; i < 8; i++) {
        if (i == 6)
            sa = this.ldt;
        else if (i == 7)
            sa = this.tr;
        else
            sa = this.segs[i];
        na += ta[i] + "=" + _1_byte_(sa.selector) + " " + _4_bytes_(sa.base) + " "
            + _4_bytes_(sa.limit) + " " + _1_byte_((sa.flags >> 8) & 0xf0ff);
        if (i & 1) {
            console.log(na);
            na = "";
        } else {
            na += " ";
        }
    }
    sa = this.gdt;
    na = "GDT=     " + _4_bytes_(sa.base) + " " + _4_bytes_(sa.limit) + "      ";
    sa = this.idt;
    na += "IDT=     " + _4_bytes_(sa.base) + " " + _4_bytes_(sa.limit);
    console.log(na);
};

CPU_X86.prototype.exec_internal = function(N_cycles, va) {
    var cpu, mem8_loc, regs;
    var _src, _dst, _op, _op2, _dst2;
    var CS_flags, mem8, register_0, OPbyte, register_1, x, Ha, Ia, Ja, cycles_left, La, Ma;
    var CS_base, SS_base, SS_mask, FS_usage_flag, init_CS_flags, Sa;
    var phys_mem8, last_tlb_val;
    var phys_mem16, phys_mem32;
    var tlb_read_kernel, tlb_write_kernel, tlb_read_user, tlb_write_user, _tlb_read_, _tlb_write_;

    /* Storing XOR values as small lookup table is software equivalent of a Translation Lookaside Buffer (TLB) */
    function __ld_8bits_mem8_read() {
        var eb;
        do_tlb_set_page(mem8_loc, 0, cpu.cpl == 3);
        eb = _tlb_read_[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[eb];
    }
    function ld_8bits_mem8_read() {
        var last_tlb_val;
        return (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
    }
    function __ld_16bits_mem8_read() {
        var x;
        x = ld_8bits_mem8_read();
        mem8_loc++;
        x |= ld_8bits_mem8_read() << 8;
        mem8_loc--;
        return x;
    }
    function ld_16bits_mem8_read() {
        var last_tlb_val;
        return (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) | mem8_loc) & 1 ? __ld_16bits_mem8_read() : phys_mem16[(mem8_loc ^ last_tlb_val) >> 1]);
    }
    function __ld_32bits_mem8_read() {
        var x;
        x = ld_8bits_mem8_read();
        mem8_loc++;
        x |= ld_8bits_mem8_read() << 8;
        mem8_loc++;
        x |= ld_8bits_mem8_read() << 16;
        mem8_loc++;
        x |= ld_8bits_mem8_read() << 24;
        mem8_loc -= 3;
        return x;
    }
    function ld_32bits_mem8_read() {
        var last_tlb_val;
        return (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_read() : phys_mem32[(mem8_loc ^ last_tlb_val) >> 2]);
    }
    function __ld_8bits_mem8_write() {
        var eb;
        do_tlb_set_page(mem8_loc, 1, cpu.cpl == 3);
        eb = _tlb_write_[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[eb];
    }
    function ld_8bits_mem8_write() {
        var eb;
        return ((eb = _tlb_write_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_write() : phys_mem8[mem8_loc ^ eb];
    }
    function __ld_16bits_mem8_write() {
        var x;
        x = ld_8bits_mem8_write();
        mem8_loc++;
        x |= ld_8bits_mem8_write() << 8;
        mem8_loc--;
        return x;
    }
    function ld_16bits_mem8_write() {
        var eb;
        return ((eb = _tlb_write_[mem8_loc >>> 12]) | mem8_loc) & 1 ? __ld_16bits_mem8_write() : phys_mem16[(mem8_loc ^ eb) >> 1];
    }
    function __ld_32bits_mem8_write() {
        var x;
        x = ld_8bits_mem8_write();
        mem8_loc++;
        x |= ld_8bits_mem8_write() << 8;
        mem8_loc++;
        x |= ld_8bits_mem8_write() << 16;
        mem8_loc++;
        x |= ld_8bits_mem8_write() << 24;
        mem8_loc -= 3;
        return x;
    }
    function ld_32bits_mem8_write() {
        var eb;
        return ((eb = _tlb_write_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_write() : phys_mem32[(mem8_loc ^ eb) >> 2];
    }
    function rb(x) {
        var eb;
        do_tlb_set_page(mem8_loc, 1, cpu.cpl == 3);
        eb = _tlb_write_[mem8_loc >>> 12] ^ mem8_loc;
        phys_mem8[eb] = x;
    }
    function sb(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if (last_tlb_val == -1) {
                rb(x);
            } else {
                phys_mem8[mem8_loc ^ last_tlb_val] = x;
            }
        }
    }
    function tb(x) {
        sb(x);
        mem8_loc++;
        sb(x >> 8);
        mem8_loc--;
    }
    function ub(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if ((last_tlb_val | mem8_loc) & 1) {
                tb(x);
            } else {
                phys_mem16[(mem8_loc ^ last_tlb_val) >> 1] = x;
            }
        }
    }
    function vb(x) {
        sb(x);
        mem8_loc++;
        sb(x >> 8);
        mem8_loc++;
        sb(x >> 16);
        mem8_loc++;
        sb(x >> 24);
        mem8_loc -= 3;
    }
    function wb(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if ((last_tlb_val | mem8_loc) & 3) {
                vb(x);
            } else {
                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
            }
        }
    }
    function xb() {
        var eb;
        do_tlb_set_page(mem8_loc, 0, 0);
        eb = tlb_read_kernel[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[eb];
    }
    function yb() {
        var eb;
        return ((eb = tlb_read_kernel[mem8_loc >>> 12]) == -1) ? xb() : phys_mem8[mem8_loc ^ eb];
    }
    function zb() {
        var x;
        x = yb();
        mem8_loc++;
        x |= yb() << 8;
        mem8_loc--;
        return x;
    }
    function Ab() {
        var eb;
        return ((eb = tlb_read_kernel[mem8_loc >>> 12]) | mem8_loc) & 1 ? zb() : phys_mem16[(mem8_loc ^ eb) >> 1];
    }
    function Bb() {
        var x;
        x = yb();
        mem8_loc++;
        x |= yb() << 8;
        mem8_loc++;
        x |= yb() << 16;
        mem8_loc++;
        x |= yb() << 24;
        mem8_loc -= 3;
        return x;
    }
    function Cb() {
        var eb;
        return ((eb = tlb_read_kernel[mem8_loc >>> 12]) | mem8_loc) & 3 ? Bb() : phys_mem32[(mem8_loc ^ eb) >> 2];
    }
    function Db(x) {
        var eb;
        do_tlb_set_page(mem8_loc, 1, 0);
        eb = tlb_write_kernel[mem8_loc >>> 12] ^ mem8_loc;
        phys_mem8[eb] = x;
    }
    function Eb(x) {
        var eb;
        eb = tlb_write_kernel[mem8_loc >>> 12];
        if (eb == -1) {
            Db(x);
        } else {
            phys_mem8[mem8_loc ^ eb] = x;
        }
    }
    function Fb(x) {
        Eb(x);
        mem8_loc++;
        Eb(x >> 8);
        mem8_loc--;
    }
    function Gb(x) {
        var eb;
        eb = tlb_write_kernel[mem8_loc >>> 12];
        if ((eb | mem8_loc) & 1) {
            Fb(x);
        } else {
            phys_mem16[(mem8_loc ^ eb) >> 1] = x;
        }
    }
    function Hb(x) {
        Eb(x);
        mem8_loc++;
        Eb(x >> 8);
        mem8_loc++;
        Eb(x >> 16);
        mem8_loc++;
        Eb(x >> 24);
        mem8_loc -= 3;
    }
    function Ib(x) {
        var eb;
        eb = tlb_write_kernel[mem8_loc >>> 12];
        if ((eb | mem8_loc) & 3) {
            Hb(x);
        } else {
            phys_mem32[(mem8_loc ^ eb) >> 2] = x;
        }
    }
    var eip, mem_ptr, Lb, initial_mem_ptr, Nb;
    function Ob() {
        var x, Ha;
        x = phys_mem8[mem_ptr++];
        Ha = phys_mem8[mem_ptr++];
        return x | (Ha << 8);
    }
    function Pb(mem8) {
        var base, mem8_loc, Qb, Rb, Sb, Tb;
        if (FS_usage_flag && (CS_flags & (0x000f | 0x0080)) == 0) {
            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                case 0x04:
                    Qb = phys_mem8[mem_ptr++];
                    base = Qb & 7;
                    if (base == 5) {
                        {
                            mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                    } else {
                        mem8_loc = regs[base];
                    }
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x0c:
                    Qb = phys_mem8[mem_ptr++];
                    mem8_loc = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    base = Qb & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x14:
                    Qb = phys_mem8[mem_ptr++];
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    base = Qb & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x05:
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    break;
                case 0x00:
                case 0x01:
                case 0x02:
                case 0x03:
                case 0x06:
                case 0x07:
                    base = mem8 & 7;
                    mem8_loc = regs[base];
                    break;
                case 0x08:
                case 0x09:
                case 0x0a:
                case 0x0b:
                case 0x0d:
                case 0x0e:
                case 0x0f:
                    mem8_loc = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    base = mem8 & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    break;
                case 0x10:
                case 0x11:
                case 0x12:
                case 0x13:
                case 0x15:
                case 0x16:
                case 0x17:
                default:
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    base = mem8 & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    break;
            }
            return mem8_loc;
        } else if (CS_flags & 0x0080) {
            if ((mem8 & 0xc7) == 0x06) {
                mem8_loc = Ob();
                Tb = 3;
            } else {
                switch (mem8 >> 6) {
                    case 0:
                        mem8_loc = 0;
                        break;
                    case 1:
                        mem8_loc = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        break;
                    default:
                        mem8_loc = Ob();
                        break;
                }
                switch (mem8 & 7) {
                    case 0:
                        mem8_loc = (mem8_loc + regs[3] + regs[6]) & 0xffff;
                        Tb = 3;
                        break;
                    case 1:
                        mem8_loc = (mem8_loc + regs[3] + regs[7]) & 0xffff;
                        Tb = 3;
                        break;
                    case 2:
                        mem8_loc = (mem8_loc + regs[5] + regs[6]) & 0xffff;
                        Tb = 2;
                        break;
                    case 3:
                        mem8_loc = (mem8_loc + regs[5] + regs[7]) & 0xffff;
                        Tb = 2;
                        break;
                    case 4:
                        mem8_loc = (mem8_loc + regs[6]) & 0xffff;
                        Tb = 3;
                        break;
                    case 5:
                        mem8_loc = (mem8_loc + regs[7]) & 0xffff;
                        Tb = 3;
                        break;
                    case 6:
                        mem8_loc = (mem8_loc + regs[5]) & 0xffff;
                        Tb = 2;
                        break;
                    case 7:
                    default:
                        mem8_loc = (mem8_loc + regs[3]) & 0xffff;
                        Tb = 3;
                        break;
                }
            }
            Sb = CS_flags & 0x000f;
            if (Sb == 0) {
                Sb = Tb;
            } else {
                Sb--;
            }
            mem8_loc = (mem8_loc + cpu.segs[Sb].base) >> 0;
            return mem8_loc;
        } else {
            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                case 0x04:
                    Qb = phys_mem8[mem_ptr++];
                    base = Qb & 7;
                    if (base == 5) {
                        {
                            mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        base = 0;
                    } else {
                        mem8_loc = regs[base];
                    }
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x0c:
                    Qb = phys_mem8[mem_ptr++];
                    mem8_loc = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    base = Qb & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x14:
                    Qb = phys_mem8[mem_ptr++];
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    base = Qb & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        mem8_loc = (mem8_loc + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x05:
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    base = 0;
                    break;
                case 0x00:
                case 0x01:
                case 0x02:
                case 0x03:
                case 0x06:
                case 0x07:
                    base = mem8 & 7;
                    mem8_loc = regs[base];
                    break;
                case 0x08:
                case 0x09:
                case 0x0a:
                case 0x0b:
                case 0x0d:
                case 0x0e:
                case 0x0f:
                    mem8_loc = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    base = mem8 & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    break;
                case 0x10:
                case 0x11:
                case 0x12:
                case 0x13:
                case 0x15:
                case 0x16:
                case 0x17:
                default:
                    {
                        mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    base = mem8 & 7;
                    mem8_loc = (mem8_loc + regs[base]) >> 0;
                    break;
            }
            Sb = CS_flags & 0x000f;
            if (Sb == 0) {
                if (base == 4 || base == 5)
                    Sb = 2;
                else
                    Sb = 3;
            } else {
                Sb--;
            }
            mem8_loc = (mem8_loc + cpu.segs[Sb].base) >> 0;
            return mem8_loc;
        }
    }
    function Ub() {
        var mem8_loc, Sb;
        if (CS_flags & 0x0080) {
            mem8_loc = Ob();
        } else {
            {
                mem8_loc = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                mem_ptr += 4;
            }
        }
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        mem8_loc = (mem8_loc + cpu.segs[Sb].base) >> 0;
        return mem8_loc;
    }
    function set_either_two_bytes_of_reg_ABCD(register_1, x) {
        /*
           if arg[0] is = 1xx  then set register xx's upper two bytes to two bytes in arg[1]
           if arg[0] is = 0xx  then set register xx's lower two bytes to two bytes in arg[1]
        */
        if (register_1 & 4)
            regs[register_1 & 3] = (regs[register_1 & 3] & -65281) | ((x & 0xff) << 8);
        else
            regs[register_1 & 3] = (regs[register_1 & 3] & -256) | (x & 0xff);
    }
    function set_lower_two_bytes_of_register(register_1, x) {
        regs[register_1] = (regs[register_1] & -65536) | (x & 0xffff);
    }
    function do_32bit_math(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (Yb + Zb) >> 0;
                _dst = Yb;
                _op = 2;
                break;
            case 1:
                Yb = Yb | Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 2:
                ac = check_carry();
                _src = Zb;
                Yb = (Yb + Zb + ac) >> 0;
                _dst = Yb;
                _op = ac ? 5 : 2;
                break;
            case 3:
                ac = check_carry();
                _src = Zb;
                Yb = (Yb - Zb - ac) >> 0;
                _dst = Yb;
                _op = ac ? 11 : 8;
                break;
            case 4:
                Yb = Yb & Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 5:
                _src = Zb;
                Yb = (Yb - Zb) >> 0;
                _dst = Yb;
                _op = 8;
                break;
            case 6:
                Yb = Yb ^ Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 7:
                _src = Zb;
                _dst = (Yb - Zb) >> 0;
                _op = 8;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function do_16bit_math(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (((Yb + Zb) << 16) >> 16);
                _dst = Yb;
                _op = 1;
                break;
            case 1:
                Yb = (((Yb | Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 2:
                ac = check_carry();
                _src = Zb;
                Yb = (((Yb + Zb + ac) << 16) >> 16);
                _dst = Yb;
                _op = ac ? 4 : 1;
                break;
            case 3:
                ac = check_carry();
                _src = Zb;
                Yb = (((Yb - Zb - ac) << 16) >> 16);
                _dst = Yb;
                _op = ac ? 10 : 7;
                break;
            case 4:
                Yb = (((Yb & Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 5:
                _src = Zb;
                Yb = (((Yb - Zb) << 16) >> 16);
                _dst = Yb;
                _op = 7;
                break;
            case 6:
                Yb = (((Yb ^ Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 7:
                _src = Zb;
                _dst = (((Yb - Zb) << 16) >> 16);
                _op = 7;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function ec(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x + 1) << 16) >> 16);
        _op = 26;
        return _dst;
    }
    function fc(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x - 1) << 16) >> 16);
        _op = 29;
        return _dst;
    }
    function do_8bit_math(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (((Yb + Zb) << 24) >> 24);
                _dst = Yb;
                _op = 0;
                break;
            case 1:
                Yb = (((Yb | Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 2:
                ac = check_carry();
                _src = Zb;
                Yb = (((Yb + Zb + ac) << 24) >> 24);
                _dst = Yb;
                _op = ac ? 3 : 0;
                break;
            case 3:
                ac = check_carry();
                _src = Zb;
                Yb = (((Yb - Zb - ac) << 24) >> 24);
                _dst = Yb;
                _op = ac ? 9 : 6;
                break;
            case 4:
                Yb = (((Yb & Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 5:
                _src = Zb;
                Yb = (((Yb - Zb) << 24) >> 24);
                _dst = Yb;
                _op = 6;
                break;
            case 6:
                Yb = (((Yb ^ Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 7:
                _src = Zb;
                _dst = (((Yb - Zb) << 24) >> 24);
                _op = 6;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function hc(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x + 1) << 24) >> 24);
        _op = 25;
        return _dst;
    }
    function ic(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x - 1) << 24) >> 24);
        _op = 28;
        return _dst;
    }
    function shift8(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                if (Zb & 0x1f) {
                    Zb &= 0x7;
                    Yb &= 0xff;
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (8 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) << 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                if (Zb & 0x1f) {
                    Zb &= 0x7;
                    Yb &= 0xff;
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (8 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 7) & 0x0001) | (((kc ^ Yb) << 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb = used_by_shift8[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xff;
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (9 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) << 4) & 0x0800) | ((kc >> (8 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb = used_by_shift8[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xff;
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb >>> Zb) | (ac << (8 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (9 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) << 4) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = (((Yb << Zb) << 24) >> 24);
                    _op = 15;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    Yb &= 0xff;
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = (((Yb >>> Zb) << 24) >> 24);
                    _op = 18;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    Yb = (Yb << 24) >> 24;
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = (((Yb >> Zb) << 24) >> 24);
                    _op = 18;
                }
                break;
            default:
                throw "unsupported shift8=" + Ja;
        }
        return Yb;
    }
    function shift16(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                if (Zb & 0x1f) {
                    Zb &= 0xf;
                    Yb &= 0xffff;
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (16 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) >> 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                if (Zb & 0x1f) {
                    Zb &= 0xf;
                    Yb &= 0xffff;
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (16 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 15) & 0x0001) | (((kc ^ Yb) >> 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb = used_by_shift16[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xffff;
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (17 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 4) & 0x0800) | ((kc >> (16 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb = used_by_shift16[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xffff;
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb >>> Zb) | (ac << (16 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (17 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 4) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = (((Yb << Zb) << 16) >> 16);
                    _op = 16;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    Yb &= 0xffff;
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = (((Yb >>> Zb) << 16) >> 16);
                    _op = 19;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    Yb = (Yb << 16) >> 16;
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = (((Yb >> Zb) << 16) >> 16);
                    _op = 19;
                }
                break;
            default:
                throw "unsupported shift16=" + Ja;
        }
        return Yb;
    }
    function nc(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (32 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) >> 20) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (32 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 31) & 0x0001) | (((kc ^ Yb) >> 20) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (33 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 20) & 0x0800) | ((kc >> (32 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    ac = check_carry();
                    Yb = (Yb >>> Zb) | (ac << (32 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (33 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 20) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = Yb << Zb;
                    _op = 17;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = Yb >>> Zb;
                    _op = 20;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = Yb >> Zb;
                    _op = 20;
                }
                break;
            default:
                throw "unsupported shift32=" + Ja;
        }
        return Yb;
    }
    function oc(Ja, Yb, Zb, pc) {
        var qc;
        pc &= 0x1f;
        if (pc) {
            if (Ja == 0) {
                Zb &= 0xffff;
                qc = Zb | (Yb << 16);
                _src = qc >> (32 - pc);
                qc <<= pc;
                if (pc > 16)
                    qc |= Zb << (pc - 16);
                Yb = _dst = qc >> 16;
                _op = 19;
            } else {
                qc = (Yb & 0xffff) | (Zb << 16);
                _src = qc >> (pc - 1);
                qc >>= pc;
                if (pc > 16)
                    qc |= Zb << (32 - pc);
                Yb = _dst = (((qc) << 16) >> 16);
                _op = 19;
            }
        }
        return Yb;
    }
    function rc(Yb, Zb, pc) {
        pc &= 0x1f;
        if (pc) {
            _src = Yb << (pc - 1);
            _dst = Yb = (Yb << pc) | (Zb >>> (32 - pc));
            _op = 17;
        }
        return Yb;
    }
    function sc(Yb, Zb, pc) {
        pc &= 0x1f;
        if (pc) {
            _src = Yb >> (pc - 1);
            _dst = Yb = (Yb >>> pc) | (Zb << (32 - pc));
            _op = 20;
        }
        return Yb;
    }
    function tc(Yb, Zb) {
        Zb &= 0xf;
        _src = Yb >> Zb;
        _op = 19;
    }
    function uc(Yb, Zb) {
        Zb &= 0x1f;
        _src = Yb >> Zb;
        _op = 20;
    }
    function vc(Ja, Yb, Zb) {
        var wc;
        Zb &= 0xf;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (Ja) {
            case 1:
                Yb |= wc;
                break;
            case 2:
                Yb &= ~wc;
                break;
            case 3:
            default:
                Yb ^= wc;
                break;
        }
        _op = 19;
        return Yb;
    }
    function xc(Ja, Yb, Zb) {
        var wc;
        Zb &= 0x1f;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (Ja) {
            case 1:
                Yb |= wc;
                break;
            case 2:
                Yb &= ~wc;
                break;
            case 3:
            default:
                Yb ^= wc;
                break;
        }
        _op = 20;
        return Yb;
    }
    function yc(Yb, Zb) {
        Zb &= 0xffff;
        if (Zb) {
            Yb = 0;
            while ((Zb & 1) == 0) {
                Yb++;
                Zb >>= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function zc(Yb, Zb) {
        if (Zb) {
            Yb = 0;
            while ((Zb & 1) == 0) {
                Yb++;
                Zb >>= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Ac(Yb, Zb) {
        Zb &= 0xffff;
        if (Zb) {
            Yb = 15;
            while ((Zb & 0x8000) == 0) {
                Yb--;
                Zb <<= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Bc(Yb, Zb) {
        if (Zb) {
            Yb = 31;
            while (Zb >= 0) {
                Yb--;
                Zb <<= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Cc(OPbyte) {
        var a, q, r;
        a = regs[0] & 0xffff;
        OPbyte &= 0xff;
        if ((a >> 8) >= OPbyte)
            blow_up_errcode0(0);
        q = (a / OPbyte) >> 0;
        r = (a % OPbyte);
        set_lower_two_bytes_of_register(0, (q & 0xff) | (r << 8));
    }
    function Ec(OPbyte) {
        var a, q, r;
        a = (regs[0] << 16) >> 16;
        OPbyte = (OPbyte << 24) >> 24;
        if (OPbyte == 0)
            blow_up_errcode0(0);
        q = (a / OPbyte) >> 0;
        if (((q << 24) >> 24) != q)
            blow_up_errcode0(0);
        r = (a % OPbyte);
        set_lower_two_bytes_of_register(0, (q & 0xff) | (r << 8));
    }
    function Fc(OPbyte) {
        var a, q, r;
        a = (regs[2] << 16) | (regs[0] & 0xffff);
        OPbyte &= 0xffff;
        if ((a >>> 16) >= OPbyte)
            blow_up_errcode0(0);
        q = (a / OPbyte) >> 0;
        r = (a % OPbyte);
        set_lower_two_bytes_of_register(0, q);
        set_lower_two_bytes_of_register(2, r);
    }
    function Gc(OPbyte) {
        var a, q, r;
        a = (regs[2] << 16) | (regs[0] & 0xffff);
        OPbyte = (OPbyte << 16) >> 16;
        if (OPbyte == 0)
            blow_up_errcode0(0);
        q = (a / OPbyte) >> 0;
        if (((q << 16) >> 16) != q)
            blow_up_errcode0(0);
        r = (a % OPbyte);
        set_lower_two_bytes_of_register(0, q);
        set_lower_two_bytes_of_register(2, r);
    }
    function Hc(Ic, Jc, OPbyte) {
        var a, i, Kc;
        Ic = Ic >>> 0;
        Jc = Jc >>> 0;
        OPbyte = OPbyte >>> 0;
        if (Ic >= OPbyte) {
            blow_up_errcode0(0);
        }
        if (Ic >= 0 && Ic <= 0x200000) {
            a = Ic * 4294967296 + Jc;
            Ma = (a % OPbyte) >> 0;
            return (a / OPbyte) >> 0;
        } else {
            for (i = 0; i < 32; i++) {
                Kc = Ic >> 31;
                Ic = ((Ic << 1) | (Jc >>> 31)) >>> 0;
                if (Kc || Ic >= OPbyte) {
                    Ic = Ic - OPbyte;
                    Jc = (Jc << 1) | 1;
                } else {
                    Jc = Jc << 1;
                }
            }
            Ma = Ic >> 0;
            return Jc;
        }
    }
    function Lc(Ic, Jc, OPbyte) {
        var Mc, Nc, q;
        if (Ic < 0) {
            Mc = 1;
            Ic = ~Ic;
            Jc = (-Jc) >> 0;
            if (Jc == 0)
                Ic = (Ic + 1) >> 0;
        } else {
            Mc = 0;
        }
        if (OPbyte < 0) {
            OPbyte = (-OPbyte) >> 0;
            Nc = 1;
        } else {
            Nc = 0;
        }
        q = Hc(Ic, Jc, OPbyte);
        Nc ^= Mc;
        if (Nc) {
            if ((q >>> 0) > 0x80000000)
                blow_up_errcode0(0);
            q = (-q) >> 0;
        } else {
            if ((q >>> 0) >= 0x80000000)
                blow_up_errcode0(0);
        }
        if (Mc) {
            Ma = (-Ma) >> 0;
        }
        return q;
    }
    function Oc(a, OPbyte) {
        var qc;
        a &= 0xff;
        OPbyte &= 0xff;
        qc = (regs[0] & 0xff) * (OPbyte & 0xff);
        _src = qc >> 8;
        _dst = (((qc) << 24) >> 24);
        _op = 21;
        return qc;
    }
    function Pc(a, OPbyte) {
        var qc;
        a = (((a) << 24) >> 24);
        OPbyte = (((OPbyte) << 24) >> 24);
        qc = (a * OPbyte) >> 0;
        _dst = (((qc) << 24) >> 24);
        _src = (qc != _dst) >> 0;
        _op = 21;
        return qc;
    }
    function Qc(a, OPbyte) {
        var qc;
        qc = ((a & 0xffff) * (OPbyte & 0xffff)) >> 0;
        _src = qc >>> 16;
        _dst = (((qc) << 16) >> 16);
        _op = 22;
        return qc;
    }
    function Rc(a, OPbyte) {
        var qc;
        a = (a << 16) >> 16;
        OPbyte = (OPbyte << 16) >> 16;
        qc = (a * OPbyte) >> 0;
        _dst = (((qc) << 16) >> 16);
        _src = (qc != _dst) >> 0;
        _op = 22;
        return qc;
    }
    function Sc(a, OPbyte) {
        var r, Jc, Ic, Tc, Uc, m;
        a = a >>> 0;
        OPbyte = OPbyte >>> 0;
        r = a * OPbyte;
        if (r <= 0xffffffff) {
            Ma = 0;
            r &= -1;
        } else {
            Jc = a & 0xffff;
            Ic = a >>> 16;
            Tc = OPbyte & 0xffff;
            Uc = OPbyte >>> 16;
            r = Jc * Tc;
            Ma = Ic * Uc;
            m = Jc * Uc;
            r += (((m & 0xffff) << 16) >>> 0);
            Ma += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                Ma++;
            }
            m = Ic * Tc;
            r += (((m & 0xffff) << 16) >>> 0);
            Ma += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                Ma++;
            }
            r &= -1;
            Ma &= -1;
        }
        return r;
    }
    function Vc(a, OPbyte) {
        _dst = Sc(a, OPbyte);
        _src = Ma;
        _op = 23;
        return _dst;
    }
    function Wc(a, OPbyte) {
        var s, r;
        s = 0;
        if (a < 0) {
            a = -a;
            s = 1;
        }
        if (OPbyte < 0) {
            OPbyte = -OPbyte;
            s ^= 1;
        }
        r = Sc(a, OPbyte);
        if (s) {
            Ma = ~Ma;
            r = (-r) >> 0;
            if (r == 0) {
                Ma = (Ma + 1) >> 0;
            }
        }
        _dst = r;
        _src = (Ma - (r >> 31)) >> 0;
        _op = 23;
        return r;
    }
    function check_carry() {
        var Yb, qc, Xc, Yc;
        if (_op >= 25) {
            Xc = _op2;
            Yc = _dst2;
        } else {
            Xc = _op;
            Yc = _dst;
        }
        switch (Xc) {
            case 0:
                qc = (Yc & 0xff) < (_src & 0xff);
                break;
            case 1:
                qc = (Yc & 0xffff) < (_src & 0xffff);
                break;
            case 2:
                qc = (Yc >>> 0) < (_src >>> 0);
                break;
            case 3:
                qc = (Yc & 0xff) <= (_src & 0xff);
                break;
            case 4:
                qc = (Yc & 0xffff) <= (_src & 0xffff);
                break;
            case 5:
                qc = (Yc >>> 0) <= (_src >>> 0);
                break;
            case 6:
                qc = ((Yc + _src) & 0xff) < (_src & 0xff);
                break;
            case 7:
                qc = ((Yc + _src) & 0xffff) < (_src & 0xffff);
                break;
            case 8:
                qc = ((Yc + _src) >>> 0) < (_src >>> 0);
                break;
            case 9:
                Yb = (Yc + _src + 1) & 0xff;
                qc = Yb <= (_src & 0xff);
                break;
            case 10:
                Yb = (Yc + _src + 1) & 0xffff;
                qc = Yb <= (_src & 0xffff);
                break;
            case 11:
                Yb = (Yc + _src + 1) >>> 0;
                qc = Yb <= (_src >>> 0);
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
                qc = (_src >> 7) & 1;
                break;
            case 16:
                qc = (_src >> 15) & 1;
                break;
            case 17:
                qc = (_src >> 31) & 1;
                break;
            case 18:
            case 19:
            case 20:
                qc = _src & 1;
                break;
            case 21:
            case 22:
            case 23:
                qc = _src != 0;
                break;
            case 24:
                qc = _src & 1;
                break;
            default:
                throw "GET_CARRY: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function check_overflow() {
        var qc, Yb;
        switch (_op) {
            case 0:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 1:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 2:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 3:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 4:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 5:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 6:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 7:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 8:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 9:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 10:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 11:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
            case 18:
                qc = ((_src ^ _dst) >> 7) & 1;
                break;
            case 16:
            case 19:
                qc = ((_src ^ _dst) >> 15) & 1;
                break;
            case 17:
            case 20:
                qc = ((_src ^ _dst) >> 31) & 1;
                break;
            case 21:
            case 22:
            case 23:
                qc = _src != 0;
                break;
            case 24:
                qc = (_src >> 11) & 1;
                break;
            case 25:
                qc = (_dst & 0xff) == 0x80;
                break;
            case 26:
                qc = (_dst & 0xffff) == 0x8000;
                break;
            case 27:
                qc = (_dst == -2147483648);
                break;
            case 28:
                qc = (_dst & 0xff) == 0x7f;
                break;
            case 29:
                qc = (_dst & 0xffff) == 0x7fff;
                break;
            case 30:
                qc = _dst == 0x7fffffff;
                break;
            default:
                throw "JO: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function ad() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) & 0xff) <= (_src & 0xff);
                break;
            case 7:
                qc = ((_dst + _src) & 0xffff) <= (_src & 0xffff);
                break;
            case 8:
                qc = ((_dst + _src) >>> 0) <= (_src >>> 0);
                break;
            case 24:
                qc = (_src & (0x0040 | 0x0001)) != 0;
                break;
            default:
                qc = check_carry() | (_dst == 0);
                break;
        }
        return qc;
    }
    function check_parity() {
        if (_op == 24) {
            return (_src >> 2) & 1;
        } else {
            return parity_bit_check_array[_dst & 0xff];
        }
    }
    function cd() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) << 24) < (_src << 24);
                break;
            case 7:
                qc = ((_dst + _src) << 16) < (_src << 16);
                break;
            case 8:
                qc = ((_dst + _src) >> 0) < _src;
                break;
            case 12:
            case 25:
            case 28:
            case 13:
            case 26:
            case 29:
            case 14:
            case 27:
            case 30:
                qc = _dst < 0;
                break;
            case 24:
                qc = ((_src >> 7) ^ (_src >> 11)) & 1;
                break;
            default:
                qc = (_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) ^ check_overflow();
                break;
        }
        return qc;
    }
    function dd() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) << 24) <= (_src << 24);
                break;
            case 7:
                qc = ((_dst + _src) << 16) <= (_src << 16);
                break;
            case 8:
                qc = ((_dst + _src) >> 0) <= _src;
                break;
            case 12:
            case 25:
            case 28:
            case 13:
            case 26:
            case 29:
            case 14:
            case 27:
            case 30:
                qc = _dst <= 0;
                break;
            case 24:
                qc = (((_src >> 7) ^ (_src >> 11)) | (_src >> 6)) & 1;
                break;
            default:
                qc = ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) ^ check_overflow()) | (_dst == 0);
                break;
        }
        return qc;
    }
    function ed() {
        var Yb, qc;
        switch (_op) {
            case 0:
            case 1:
            case 2:
                Yb = (_dst - _src) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 3:
            case 4:
            case 5:
                Yb = (_dst - _src - 1) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 6:
            case 7:
            case 8:
                Yb = (_dst + _src) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 9:
            case 10:
            case 11:
                Yb = (_dst + _src + 1) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
            case 18:
            case 16:
            case 19:
            case 17:
            case 20:
            case 21:
            case 22:
            case 23:
                qc = 0;
                break;
            case 24:
                qc = _src & 0x10;
                break;
            case 25:
            case 26:
            case 27:
                qc = (_dst ^ (_dst - 1)) & 0x10;
                break;
            case 28:
            case 29:
            case 30:
                qc = (_dst ^ (_dst + 1)) & 0x10;
                break;
            default:
                throw "AF: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function check_status_bits_for_jump(gd) {
        var qc;
        switch (gd >> 1) {
            case 0:
                qc = check_overflow();
                break;
            case 1:
                qc = check_carry();
                break;
            case 2:
                qc = (_dst == 0);
                break;
            case 3:
                qc = ad();
                break;
            case 4:
                qc = (_op == 24 ? ((_src >> 7) & 1) : (_dst < 0));
                break;
            case 5:
                qc = check_parity();
                break;
            case 6:
                qc = cd();
                break;
            case 7:
                qc = dd();
                break;
            default:
                throw "unsupported cond: " + gd;
        }
        return qc ^ (gd & 1);
    }
    function lc() {
        return (check_parity() << 2) | ((_dst == 0) << 6) | ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) << 7) | ed();
    }
    function hd() {
        return (check_carry() << 0) | (check_parity() << 2) | ((_dst == 0) << 6) | ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) << 7) | (check_overflow() << 11) | ed();
    }
    function id() {
        var jd;
        jd = hd();
        jd |= cpu.df & 0x00000400;
        jd |= cpu.eflags;
        return jd;
    }
    function kd(jd, ld) {
        _src = jd & (0x0800 | 0x0080 | 0x0040 | 0x0010 | 0x0004 | 0x0001);
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
        cpu.df = 1 - (2 * ((jd >> 10) & 1));
        cpu.eflags = (cpu.eflags & ~ld) | (jd & ld);
    }
    function current_cycle_count() {
        return cpu.cycle_count + (N_cycles - cycles_left);
    }
    function cpu_abort(na) {
        throw "CPU abort: " + na;
    }
    function cpu_dump() {
        cpu.eip = eip;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = _op2;
        cpu.cc_dst2 = _dst2;
        cpu.dump();
    }
    function cpu_dump_short() {
        cpu.eip = eip;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = _op2;
        cpu.cc_dst2 = _dst2;
        cpu.dump_short();
    }

    /* Oh Noes! */
    function blow_up(intno, error_code) {
        cpu.cycle_count += (N_cycles - cycles_left);
        cpu.eip = eip;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = _op2;
        cpu.cc_dst2 = _dst2;
        throw {intno: intno, error_code: error_code};
    }
    function blow_up_errcode0(intno) {
        blow_up(intno, 0);
    }

    function change_permission_level(sd) {
        cpu.cpl = sd;
        if (cpu.cpl == 3) {
            _tlb_read_ = tlb_read_user;
            _tlb_write_ = tlb_write_user;
        } else {
            _tlb_read_ = tlb_read_kernel;
            _tlb_write_ = tlb_write_kernel;
        }
    }
    function td(mem8_loc, ud) {
        var eb;
        if (ud) {
            eb = _tlb_write_[mem8_loc >>> 12];
        } else {
            eb = _tlb_read_[mem8_loc >>> 12];
        }
        if (eb == -1) {
            do_tlb_set_page(mem8_loc, ud, cpu.cpl == 3);
            if (ud) {
                eb = _tlb_write_[mem8_loc >>> 12];
            } else {
                eb = _tlb_read_[mem8_loc >>> 12];
            }
        }
        return eb ^ mem8_loc;
    }
    function vd(x) {
        var wd;
        wd = regs[4] - 2;
        mem8_loc = ((wd & SS_mask) + SS_base) >> 0;
        ub(x);
        regs[4] = (regs[4] & ~SS_mask) | ((wd) & SS_mask);
    }
    function xd(x) {
        var wd;
        wd = regs[4] - 4;
        mem8_loc = ((wd & SS_mask) + SS_base) >> 0;
        wb(x);
        regs[4] = (regs[4] & ~SS_mask) | ((wd) & SS_mask);
    }
    function yd() {
        mem8_loc = ((regs[4] & SS_mask) + SS_base) >> 0;
        return ld_16bits_mem8_read();
    }
    function zd() {
        regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 2) & SS_mask);
    }
    function Ad() {
        mem8_loc = ((regs[4] & SS_mask) + SS_base) >> 0;
        return ld_32bits_mem8_read();
    }
    function Bd() {
        regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 4) & SS_mask);
    }
    function Cd(Nb, OPbyte) {
        var n, CS_flags, l, mem8, Dd, base, Ja, Ed;
        n = 1;
        CS_flags = init_CS_flags;
        if (CS_flags & 0x0100)
            Ed = 2;
        else
            Ed = 4;
        Fd: for (; ; ) {
            switch (OPbyte) {
                case 0x66:
                    if (init_CS_flags & 0x0100) {
                        Ed = 4;
                        CS_flags &= ~0x0100;
                    } else {
                        Ed = 2;
                        CS_flags |= 0x0100;
                    }
                case 0xf0:
                case 0xf2:
                case 0xf3:
                case 0x26:
                case 0x2e:
                case 0x36:
                case 0x3e:
                case 0x64:
                case 0x65:
                    {
                        if ((n + 1) > 15)
                            blow_up_errcode0(6);
                        mem8_loc = (Nb + (n++)) >> 0;
                        OPbyte = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    break;
                case 0x67:
                    if (init_CS_flags & 0x0080) {
                        CS_flags &= ~0x0080;
                    } else {
                        CS_flags |= 0x0080;
                    }
                    {
                        if ((n + 1) > 15)
                            blow_up_errcode0(6);
                        mem8_loc = (Nb + (n++)) >> 0;
                        OPbyte = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    break;
                case 0x91:
                case 0x92:
                case 0x93:
                case 0x94:
                case 0x95:
                case 0x96:
                case 0x97:
                case 0x40:
                case 0x41:
                case 0x42:
                case 0x43:
                case 0x44:
                case 0x45:
                case 0x46:
                case 0x47:
                case 0x48:
                case 0x49:
                case 0x4a:
                case 0x4b:
                case 0x4c:
                case 0x4d:
                case 0x4e:
                case 0x4f:
                case 0x50:
                case 0x51:
                case 0x52:
                case 0x53:
                case 0x54:
                case 0x55:
                case 0x56:
                case 0x57:
                case 0x58:
                case 0x59:
                case 0x5a:
                case 0x5b:
                case 0x5c:
                case 0x5d:
                case 0x5e:
                case 0x5f:
                case 0x98:
                case 0x99:
                case 0xc9:
                case 0x9c:
                case 0x9d:
                case 0x06:
                case 0x0e:
                case 0x16:
                case 0x1e:
                case 0x07:
                case 0x17:
                case 0x1f:
                case 0xc3:
                case 0xcb:
                case 0x90:
                case 0xcc:
                case 0xce:
                case 0xcf:
                case 0xf5:
                case 0xf8:
                case 0xf9:
                case 0xfc:
                case 0xfd:
                case 0xfa:
                case 0xfb:
                case 0x9e:
                case 0x9f:
                case 0xf4:
                case 0xa4:
                case 0xa5:
                case 0xaa:
                case 0xab:
                case 0xa6:
                case 0xa7:
                case 0xac:
                case 0xad:
                case 0xae:
                case 0xaf:
                case 0x9b:
                case 0xec:
                case 0xed:
                case 0xee:
                case 0xef:
                case 0xd7:
                case 0x27:
                case 0x2f:
                case 0x37:
                case 0x3f:
                case 0x60:
                case 0x61:
                case 0x6c:
                case 0x6d:
                case 0x6e:
                case 0x6f:
                    break Fd;
                case 0xb0:
                case 0xb1:
                case 0xb2:
                case 0xb3:
                case 0xb4:
                case 0xb5:
                case 0xb6:
                case 0xb7:
                case 0x04:
                case 0x0c:
                case 0x14:
                case 0x1c:
                case 0x24:
                case 0x2c:
                case 0x34:
                case 0x3c:
                case 0xa8:
                case 0x6a:
                case 0xeb:
                case 0x70:
                case 0x71:
                case 0x72:
                case 0x73:
                case 0x76:
                case 0x77:
                case 0x78:
                case 0x79:
                case 0x7a:
                case 0x7b:
                case 0x7c:
                case 0x7d:
                case 0x7e:
                case 0x7f:
                case 0x74:
                case 0x75:
                case 0xe0:
                case 0xe1:
                case 0xe2:
                case 0xe3:
                case 0xcd:
                case 0xe4:
                case 0xe5:
                case 0xe6:
                case 0xe7:
                case 0xd4:
                case 0xd5:
                    n++;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xb8:
                case 0xb9:
                case 0xba:
                case 0xbb:
                case 0xbc:
                case 0xbd:
                case 0xbe:
                case 0xbf:
                case 0x05:
                case 0x0d:
                case 0x15:
                case 0x1d:
                case 0x25:
                case 0x2d:
                case 0x35:
                case 0x3d:
                case 0xa9:
                case 0x68:
                case 0xe9:
                case 0xe8:
                    n += Ed;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0x88:
                case 0x89:
                case 0x8a:
                case 0x8b:
                case 0x86:
                case 0x87:
                case 0x8e:
                case 0x8c:
                case 0xc4:
                case 0xc5:
                case 0x00:
                case 0x08:
                case 0x10:
                case 0x18:
                case 0x20:
                case 0x28:
                case 0x30:
                case 0x38:
                case 0x01:
                case 0x09:
                case 0x11:
                case 0x19:
                case 0x21:
                case 0x29:
                case 0x31:
                case 0x39:
                case 0x02:
                case 0x0a:
                case 0x12:
                case 0x1a:
                case 0x22:
                case 0x2a:
                case 0x32:
                case 0x3a:
                case 0x03:
                case 0x0b:
                case 0x13:
                case 0x1b:
                case 0x23:
                case 0x2b:
                case 0x33:
                case 0x3b:
                case 0x84:
                case 0x85:
                case 0xd0:
                case 0xd1:
                case 0xd2:
                case 0xd3:
                case 0x8f:
                case 0x8d:
                case 0xfe:
                case 0xff:
                case 0xd8:
                case 0xd9:
                case 0xda:
                case 0xdb:
                case 0xdc:
                case 0xdd:
                case 0xde:
                case 0xdf:
                case 0x62:
                case 0x63:
                    {
                        {
                            if ((n + 1) > 15)
                                blow_up_errcode0(6);
                            mem8_loc = (Nb + (n++)) >> 0;
                            mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                        }
                        if (CS_flags & 0x0080) {
                            switch (mem8 >> 6) {
                                case 0:
                                    if ((mem8 & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            blow_up_errcode0(6);
                                        mem8_loc = (Nb + (n++)) >> 0;
                                        Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                    }
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xa0:
                case 0xa1:
                case 0xa2:
                case 0xa3:
                    if (CS_flags & 0x0100)
                        n += 2;
                    else
                        n += 4;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xc6:
                case 0x80:
                case 0x82:
                case 0x83:
                case 0x6b:
                case 0xc0:
                case 0xc1:
                    {
                        {
                            if ((n + 1) > 15)
                                blow_up_errcode0(6);
                            mem8_loc = (Nb + (n++)) >> 0;
                            mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                        }
                        if (CS_flags & 0x0080) {
                            switch (mem8 >> 6) {
                                case 0:
                                    if ((mem8 & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            blow_up_errcode0(6);
                                        mem8_loc = (Nb + (n++)) >> 0;
                                        Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                    }
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    n++;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xc7:
                case 0x81:
                case 0x69:
                    {
                        {
                            if ((n + 1) > 15)
                                blow_up_errcode0(6);
                            mem8_loc = (Nb + (n++)) >> 0;
                            mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                        }
                        if (CS_flags & 0x0080) {
                            switch (mem8 >> 6) {
                                case 0:
                                    if ((mem8 & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            blow_up_errcode0(6);
                                        mem8_loc = (Nb + (n++)) >> 0;
                                        Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                    }
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    n += Ed;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xf6:
                    {
                        {
                            if ((n + 1) > 15)
                                blow_up_errcode0(6);
                            mem8_loc = (Nb + (n++)) >> 0;
                            mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                        }
                        if (CS_flags & 0x0080) {
                            switch (mem8 >> 6) {
                                case 0:
                                    if ((mem8 & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            blow_up_errcode0(6);
                                        mem8_loc = (Nb + (n++)) >> 0;
                                        Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                    }
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    Ja = (mem8 >> 3) & 7;
                    if (Ja == 0) {
                        n++;
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xf7:
                    {
                        {
                            if ((n + 1) > 15)
                                blow_up_errcode0(6);
                            mem8_loc = (Nb + (n++)) >> 0;
                            mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                        }
                        if (CS_flags & 0x0080) {
                            switch (mem8 >> 6) {
                                case 0:
                                    if ((mem8 & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            blow_up_errcode0(6);
                                        mem8_loc = (Nb + (n++)) >> 0;
                                        Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                    }
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    Ja = (mem8 >> 3) & 7;
                    if (Ja == 0) {
                        n += Ed;
                        if (n > 15)
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xea:
                case 0x9a:
                    n += 2 + Ed;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xc2:
                case 0xca:
                    n += 2;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xc8:
                    n += 3;
                    if (n > 15)
                        blow_up_errcode0(6);
                    break Fd;
                case 0xd6:
                case 0xf1:
                default:
                    blow_up_errcode0(6);
                case 0x0f:
                    {
                        if ((n + 1) > 15)
                            blow_up_errcode0(6);
                        mem8_loc = (Nb + (n++)) >> 0;
                        OPbyte = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    switch (OPbyte) {
                        case 0x06:
                        case 0xa2:
                        case 0x31:
                        case 0xa0:
                        case 0xa8:
                        case 0xa1:
                        case 0xa9:
                        case 0xc8:
                        case 0xc9:
                        case 0xca:
                        case 0xcb:
                        case 0xcc:
                        case 0xcd:
                        case 0xce:
                        case 0xcf:
                            break Fd;
                        case 0x80:
                        case 0x81:
                        case 0x82:
                        case 0x83:
                        case 0x84:
                        case 0x85:
                        case 0x86:
                        case 0x87:
                        case 0x88:
                        case 0x89:
                        case 0x8a:
                        case 0x8b:
                        case 0x8c:
                        case 0x8d:
                        case 0x8e:
                        case 0x8f:
                            n += Ed;
                            if (n > 15)
                                blow_up_errcode0(6);
                            break Fd;
                        case 0x90:
                        case 0x91:
                        case 0x92:
                        case 0x93:
                        case 0x94:
                        case 0x95:
                        case 0x96:
                        case 0x97:
                        case 0x98:
                        case 0x99:
                        case 0x9a:
                        case 0x9b:
                        case 0x9c:
                        case 0x9d:
                        case 0x9e:
                        case 0x9f:
                        case 0x40:
                        case 0x41:
                        case 0x42:
                        case 0x43:
                        case 0x44:
                        case 0x45:
                        case 0x46:
                        case 0x47:
                        case 0x48:
                        case 0x49:
                        case 0x4a:
                        case 0x4b:
                        case 0x4c:
                        case 0x4d:
                        case 0x4e:
                        case 0x4f:
                        case 0xb6:
                        case 0xb7:
                        case 0xbe:
                        case 0xbf:
                        case 0x00:
                        case 0x01:
                        case 0x02:
                        case 0x03:
                        case 0x20:
                        case 0x22:
                        case 0x23:
                        case 0xb2:
                        case 0xb4:
                        case 0xb5:
                        case 0xa5:
                        case 0xad:
                        case 0xa3:
                        case 0xab:
                        case 0xb3:
                        case 0xbb:
                        case 0xbc:
                        case 0xbd:
                        case 0xaf:
                        case 0xc0:
                        case 0xc1:
                        case 0xb0:
                        case 0xb1:
                            {
                                {
                                    if ((n + 1) > 15)
                                        blow_up_errcode0(6);
                                    mem8_loc = (Nb + (n++)) >> 0;
                                    mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                }
                                if (CS_flags & 0x0080) {
                                    switch (mem8 >> 6) {
                                        case 0:
                                            if ((mem8 & 7) == 6)
                                                n += 2;
                                            break;
                                        case 1:
                                            n++;
                                            break;
                                        default:
                                            n += 2;
                                            break;
                                    }
                                } else {
                                    switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                        case 0x04:
                                            {
                                                if ((n + 1) > 15)
                                                    blow_up_errcode0(6);
                                                mem8_loc = (Nb + (n++)) >> 0;
                                                Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                            }
                                            if ((Dd & 7) == 5) {
                                                n += 4;
                                            }
                                            break;
                                        case 0x0c:
                                            n += 2;
                                            break;
                                        case 0x14:
                                            n += 5;
                                            break;
                                        case 0x05:
                                            n += 4;
                                            break;
                                        case 0x00:
                                        case 0x01:
                                        case 0x02:
                                        case 0x03:
                                        case 0x06:
                                        case 0x07:
                                            break;
                                        case 0x08:
                                        case 0x09:
                                        case 0x0a:
                                        case 0x0b:
                                        case 0x0d:
                                        case 0x0e:
                                        case 0x0f:
                                            n++;
                                            break;
                                        case 0x10:
                                        case 0x11:
                                        case 0x12:
                                        case 0x13:
                                        case 0x15:
                                        case 0x16:
                                        case 0x17:
                                            n += 4;
                                            break;
                                    }
                                }
                                if (n > 15)
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0xa4:
                        case 0xac:
                        case 0xba:
                            {
                                {
                                    if ((n + 1) > 15)
                                        blow_up_errcode0(6);
                                    mem8_loc = (Nb + (n++)) >> 0;
                                    mem8 = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                }
                                if (CS_flags & 0x0080) {
                                    switch (mem8 >> 6) {
                                        case 0:
                                            if ((mem8 & 7) == 6)
                                                n += 2;
                                            break;
                                        case 1:
                                            n++;
                                            break;
                                        default:
                                            n += 2;
                                            break;
                                    }
                                } else {
                                    switch ((mem8 & 7) | ((mem8 >> 3) & 0x18)) {
                                        case 0x04:
                                            {
                                                if ((n + 1) > 15)
                                                    blow_up_errcode0(6);
                                                mem8_loc = (Nb + (n++)) >> 0;
                                                Dd = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                                            }
                                            if ((Dd & 7) == 5) {
                                                n += 4;
                                            }
                                            break;
                                        case 0x0c:
                                            n += 2;
                                            break;
                                        case 0x14:
                                            n += 5;
                                            break;
                                        case 0x05:
                                            n += 4;
                                            break;
                                        case 0x00:
                                        case 0x01:
                                        case 0x02:
                                        case 0x03:
                                        case 0x06:
                                        case 0x07:
                                            break;
                                        case 0x08:
                                        case 0x09:
                                        case 0x0a:
                                        case 0x0b:
                                        case 0x0d:
                                        case 0x0e:
                                        case 0x0f:
                                            n++;
                                            break;
                                        case 0x10:
                                        case 0x11:
                                        case 0x12:
                                        case 0x13:
                                        case 0x15:
                                        case 0x16:
                                        case 0x17:
                                            n += 4;
                                            break;
                                    }
                                }
                                if (n > 15)
                                    blow_up_errcode0(6);
                            }
                            n++;
                            if (n > 15)
                                blow_up_errcode0(6);
                            break Fd;
                        case 0x04:
                        case 0x05:
                        case 0x07:
                        case 0x08:
                        case 0x09:
                        case 0x0a:
                        case 0x0b:
                        case 0x0c:
                        case 0x0d:
                        case 0x0e:
                        case 0x0f:
                        case 0x10:
                        case 0x11:
                        case 0x12:
                        case 0x13:
                        case 0x14:
                        case 0x15:
                        case 0x16:
                        case 0x17:
                        case 0x18:
                        case 0x19:
                        case 0x1a:
                        case 0x1b:
                        case 0x1c:
                        case 0x1d:
                        case 0x1e:
                        case 0x1f:
                        case 0x21:
                        case 0x24:
                        case 0x25:
                        case 0x26:
                        case 0x27:
                        case 0x28:
                        case 0x29:
                        case 0x2a:
                        case 0x2b:
                        case 0x2c:
                        case 0x2d:
                        case 0x2e:
                        case 0x2f:
                        case 0x30:
                        case 0x32:
                        case 0x33:
                        case 0x34:
                        case 0x35:
                        case 0x36:
                        case 0x37:
                        case 0x38:
                        case 0x39:
                        case 0x3a:
                        case 0x3b:
                        case 0x3c:
                        case 0x3d:
                        case 0x3e:
                        case 0x3f:
                        case 0x50:
                        case 0x51:
                        case 0x52:
                        case 0x53:
                        case 0x54:
                        case 0x55:
                        case 0x56:
                        case 0x57:
                        case 0x58:
                        case 0x59:
                        case 0x5a:
                        case 0x5b:
                        case 0x5c:
                        case 0x5d:
                        case 0x5e:
                        case 0x5f:
                        case 0x60:
                        case 0x61:
                        case 0x62:
                        case 0x63:
                        case 0x64:
                        case 0x65:
                        case 0x66:
                        case 0x67:
                        case 0x68:
                        case 0x69:
                        case 0x6a:
                        case 0x6b:
                        case 0x6c:
                        case 0x6d:
                        case 0x6e:
                        case 0x6f:
                        case 0x70:
                        case 0x71:
                        case 0x72:
                        case 0x73:
                        case 0x74:
                        case 0x75:
                        case 0x76:
                        case 0x77:
                        case 0x78:
                        case 0x79:
                        case 0x7a:
                        case 0x7b:
                        case 0x7c:
                        case 0x7d:
                        case 0x7e:
                        case 0x7f:
                        case 0xa6:
                        case 0xa7:
                        case 0xaa:
                        case 0xae:
                        case 0xb8:
                        case 0xb9:
                        case 0xc2:
                        case 0xc3:
                        case 0xc4:
                        case 0xc5:
                        case 0xc6:
                        case 0xc7:
                        default:
                            blow_up_errcode0(6);
                    }
                    break;
            }
        }
        return n;
    }
    /* Typically, the upper 20 bits of CR3 become the page directory base register (PDBR),
       which stores the physical address of the first page directory entry. */
    function do_tlb_set_page(Gd, Hd, ja) {
        var Id, Jd, error_code, Kd, Ld, Md, Nd, ud, Od;
        if (!(cpu.cr0 & (1 << 31))) { //CR0: bit31 PG Paging If 1, enable paging and use the CR3 register, else disable paging
            cpu.tlb_set_page(Gd & -4096, Gd & -4096, 1);
        } else {
            Id = (cpu.cr3 & -4096) + ((Gd >> 20) & 0xffc);
            Jd = cpu.ld32_phys(Id);
            if (!(Jd & 0x00000001)) {
                error_code = 0;
            } else {
                if (!(Jd & 0x00000020)) {
                    Jd |= 0x00000020;
                    cpu.st32_phys(Id, Jd);
                }
                Kd = (Jd & -4096) + ((Gd >> 10) & 0xffc);
                Ld = cpu.ld32_phys(Kd);
                if (!(Ld & 0x00000001)) {
                    error_code = 0;
                } else {
                    Md = Ld & Jd;
                    if (ja && !(Md & 0x00000004)) {
                        error_code = 0x01;
                    } else if (Hd && !(Md & 0x00000002)) {
                        error_code = 0x01;
                    } else {
                        Nd = (Hd && !(Ld & 0x00000040));
                        if (!(Ld & 0x00000020) || Nd) {
                            Ld |= 0x00000020;
                            if (Nd)
                                Ld |= 0x00000040;
                            cpu.st32_phys(Kd, Ld);
                        }
                        ud = 0;
                        if ((Ld & 0x00000040) && (Md & 0x00000002))
                            ud = 1;
                        Od = 0;
                        if (Md & 0x00000004)
                            Od = 1;
                        cpu.tlb_set_page(Gd & -4096, Ld & -4096, ud, Od);
                        return;
                    }
                }
            }
            error_code |= Hd << 1;
            if (ja)
                error_code |= 0x04;
            cpu.cr2 = Gd;
            blow_up(14, error_code);
        }
    }
    function set_CR0(Qd) {
        if (!(Qd & (1 << 0)))  //0th bit protected or real, only real supported!
            cpu_abort("real mode not supported");
        //if changing flags 31, 16, or 0 must flush tlb
        if ((Qd & ((1 << 31) | (1 << 16) | (1 << 0))) != (cpu.cr0 & ((1 << 31) | (1 << 16) | (1 << 0)))) {
            cpu.tlb_flush_all();
        }
        cpu.cr0 = Qd | (1 << 4); //keep bit 4 set to 1
    }
    function set_CR3(Sd) {
        cpu.cr3 = Sd;
        if (cpu.cr0 & (1 << 31)) {
            cpu.tlb_flush_all();
        }
    }
    function set_CR4(Ud) {
        cpu.cr4 = Ud;
    }
    function SS_mask_from_flags(Wd) {
        if (Wd & (1 << 22))
            return -1;
        else
            return 0xffff;
    }
    function Xd(selector) {
        var sa, Rb, Yd, Wd;
        if (selector & 0x4)
            sa = cpu.ldt;
        else
            sa = cpu.gdt;
        Rb = selector & ~7;
        if ((Rb + 7) > sa.limit)
            return null;
        mem8_loc = sa.base + Rb;
        Yd = Cb();
        mem8_loc += 4;
        Wd = Cb();
        return [Yd, Wd];
    }

    /*
      Segment Handling Functions
      ------------------------------
    */
    function Zd(Yd, Wd) {
        var limit;
        limit = (Yd & 0xffff) | (Wd & 0x000f0000);
        if (Wd & (1 << 23))
            limit = (limit << 12) | 0xfff;
        return limit;
    }
    function ae(Yd, Wd) {
        return (((Yd >>> 16) | ((Wd & 0xff) << 16) | (Wd & 0xff000000))) & -1;
    }
    function be(sa, Yd, Wd) {
        sa.base = ae(Yd, Wd);
        sa.limit = Zd(Yd, Wd);
        sa.flags = Wd;
    }
    function init_segment_local_vars() {
        CS_base = cpu.segs[1].base;//CS
        SS_base = cpu.segs[2].base;//SS
        if (cpu.segs[2].flags & (1 << 22))
            SS_mask = -1;
        else
            SS_mask = 0xffff;
        FS_usage_flag = (((CS_base | SS_base | cpu.segs[3].base | cpu.segs[0].base) == 0) && SS_mask == -1);
        if (cpu.segs[1].flags & (1 << 22))
            init_CS_flags = 0;
        else
            init_CS_flags = 0x0100 | 0x0080;
    }
    function set_segment_vars(ee, selector, base, limit, flags) {
        cpu.segs[ee] = {selector: selector,base: base,limit: limit,flags: flags};
        init_segment_local_vars();
    }
    function init_segment_vars_with_selector(Sb, selector) {
        set_segment_vars(Sb, selector, (selector << 4), 0xffff, (1 << 15) | (3 << 13) | (1 << 12) | (1 << 8) | (1 << 12) | (1 << 9));
    }



    function ge(he) {
        var ie, Rb, je, ke, le;
        if (!(cpu.tr.flags & (1 << 15)))
            cpu_abort("invalid tss");
        ie = (cpu.tr.flags >> 8) & 0xf;
        if ((ie & 7) != 1)
            cpu_abort("invalid tss type");
        je = ie >> 3;
        Rb = (he * 4 + 2) << je;
        if (Rb + (4 << je) - 1 > cpu.tr.limit)
            blow_up(10, cpu.tr.selector & 0xfffc);
        mem8_loc = (cpu.tr.base + Rb) & -1;
        if (je == 0) {
            le = Ab();
            mem8_loc += 2;
        } else {
            le = Cb();
            mem8_loc += 4;
        }
        ke = Ab();
        return [ke, le];
    }
    function me(intno, ne, error_code, oe, pe) {
        var sa, qe, ie, he, selector, re, se;
        var te, ue, je;
        var e, Yd, Wd, ve, ke, le, we, xe;
        var ye, SS_mask;
        te = 0;
        if (!ne && !pe) {
            switch (intno) {
                case 8:
                case 10:
                case 11:
                case 12:
                case 13:
                case 14:
                case 17:
                    te = 1;
                    break;
            }
        }
        if (ne)
            ye = oe;
        else
            ye = eip;
        sa = cpu.idt;
        if (intno * 8 + 7 > sa.limit)
            blow_up(13, intno * 8 + 2);
        mem8_loc = (sa.base + intno * 8) & -1;
        Yd = Cb();
        mem8_loc += 4;
        Wd = Cb();
        ie = (Wd >> 8) & 0x1f;
        switch (ie) {
            case 5:
            case 7:
            case 6:
                throw "unsupported task gate";
            case 14:
            case 15:
                break;
            default:
                blow_up(13, intno * 8 + 2);
                break;
        }
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (ne && he < se)
            blow_up(13, intno * 8 + 2);
        if (!(Wd & (1 << 15)))
            blow_up(11, intno * 8 + 2);
        selector = Yd >> 16;
        ve = (Wd & -65536) | (Yd & 0x0000ffff);
        if ((selector & 0xfffc) == 0)
            blow_up(13, 0);
        e = Xd(selector);
        if (!e)
            blow_up(13, selector & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)) || !(Wd & ((1 << 11))))
            blow_up(13, selector & 0xfffc);
        he = (Wd >> 13) & 3;
        if (he > se)
            blow_up(13, selector & 0xfffc);
        if (!(Wd & (1 << 15)))
            blow_up(11, selector & 0xfffc);
        if (!(Wd & (1 << 10)) && he < se) {
            e = ge(he);
            ke = e[0];
            le = e[1];
            if ((ke & 0xfffc) == 0)
                blow_up(10, ke & 0xfffc);
            if ((ke & 3) != he)
                blow_up(10, ke & 0xfffc);
            e = Xd(ke);
            if (!e)
                blow_up(10, ke & 0xfffc);
            we = e[0];
            xe = e[1];
            re = (xe >> 13) & 3;
            if (re != he)
                blow_up(10, ke & 0xfffc);
            if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                blow_up(10, ke & 0xfffc);
            if (!(xe & (1 << 15)))
                blow_up(10, ke & 0xfffc);
            ue = 1;
            SS_mask = SS_mask_from_flags(xe);
            qe = ae(we, xe);
        } else if ((Wd & (1 << 10)) || he == se) {
            if (cpu.eflags & 0x00020000)
                blow_up(13, selector & 0xfffc);
            ue = 0;
            SS_mask = SS_mask_from_flags(cpu.segs[2].flags);
            qe = cpu.segs[2].base;
            le = regs[4];
            he = se;
        } else {
            blow_up(13, selector & 0xfffc);
            ue = 0;
            SS_mask = 0;
            qe = 0;
            le = 0;
        }
        je = ie >> 3;
        if (je == 1) {
            if (ue) {
                if (cpu.eflags & 0x00020000) {
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Ib(cpu.segs[5].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Ib(cpu.segs[4].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Ib(cpu.segs[3].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Ib(cpu.segs[0].selector);
                    }
                }
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Ib(cpu.segs[2].selector);
                }
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Ib(regs[4]);
                }
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Ib(id());
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Ib(cpu.segs[1].selector);
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Ib(ye);
            }
            if (te) {
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Ib(error_code);
                }
            }
        } else {
            if (ue) {
                if (cpu.eflags & 0x00020000) {
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Gb(cpu.segs[5].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Gb(cpu.segs[4].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Gb(cpu.segs[3].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        Gb(cpu.segs[0].selector);
                    }
                }
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Gb(cpu.segs[2].selector);
                }
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Gb(regs[4]);
                }
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Gb(id());
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Gb(cpu.segs[1].selector);
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                Gb(ye);
            }
            if (te) {
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    Gb(error_code);
                }
            }
        }
        if (ue) {
            if (cpu.eflags & 0x00020000) {
                set_segment_vars(0, 0, 0, 0, 0);
                set_segment_vars(3, 0, 0, 0, 0);
                set_segment_vars(4, 0, 0, 0, 0);
                set_segment_vars(5, 0, 0, 0, 0);
            }
            ke = (ke & ~3) | he;
            set_segment_vars(2, ke, qe, Zd(we, xe), xe);
        }
        regs[4] = (regs[4] & ~SS_mask) | ((le) & SS_mask);
        selector = (selector & ~3) | he;
        set_segment_vars(1, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        change_permission_level(he);
        eip = ve, mem_ptr = initial_mem_ptr = 0;
        if ((ie & 1) == 0) {
            cpu.eflags &= ~0x00000200;
        }
        cpu.eflags &= ~(0x00000100 | 0x00020000 | 0x00010000 | 0x00004000);
    }
    function ze(intno, ne, error_code, oe, pe) {
        var sa, qe, selector, ve, le, ye;
        sa = cpu.idt;
        if (intno * 4 + 3 > sa.limit)
            blow_up(13, intno * 8 + 2);
        mem8_loc = (sa.base + (intno << 2)) >> 0;
        ve = Ab();
        mem8_loc = (mem8_loc + 2) >> 0;
        selector = Ab();
        le = regs[4];
        if (ne)
            ye = oe;
        else
            ye = eip;
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            ub(id());
        }
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            ub(cpu.segs[1].selector);
        }
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            ub(ye);
        }
        regs[4] = (regs[4] & ~SS_mask) | ((le) & SS_mask);
        eip = ve, mem_ptr = initial_mem_ptr = 0;
        cpu.segs[1].selector = selector;
        cpu.segs[1].base = (selector << 4);
        cpu.eflags &= ~(0x00000200 | 0x00000100 | 0x00040000 | 0x00010000);
    }
    function Ae(intno, ne, error_code, oe, pe) {
        if (intno == 0x06) {
            var Be = eip;
            var Nb;
            na = "do_interrupt: intno=" + _2_bytes_(intno) + " error_code=" + _4_bytes_(error_code) + " EIP=" + _4_bytes_(Be) + " ESP=" + _4_bytes_(regs[4]) + " EAX=" + _4_bytes_(regs[0]) + " EBX=" + _4_bytes_(regs[3]) + " ECX=" + _4_bytes_(regs[1]);
            if (intno == 0x0e) {
                na += " CR2=" + _4_bytes_(cpu.cr2);
            }
            console.log(na);
            if (intno == 0x06) {
                var na, i, n;
                na = "Code:";
                Nb = (Be + CS_base) >> 0;
                n = 4096 - (Nb & 0xfff);
                if (n > 15)
                    n = 15;
                for (i = 0; i < n; i++) {
                    mem8_loc = (Nb + i) & -1;
                    na += " " + _2_bytes_(ld_8bits_mem8_read());
                }
                console.log(na);
            }
        }
        if (cpu.cr0 & (1 << 0)) {
            me(intno, ne, error_code, oe, pe);
        } else {
            ze(intno, ne, error_code, oe, pe);
        }
    }
    function Ce(selector) {
        var sa, Yd, Wd, Rb, De;
        selector &= 0xffff;
        if ((selector & 0xfffc) == 0) {
            cpu.ldt.base = 0;
            cpu.ldt.limit = 0;
        } else {
            if (selector & 0x4)
                blow_up(13, selector & 0xfffc);
            sa = cpu.gdt;
            Rb = selector & ~7;
            De = 7;
            if ((Rb + De) > sa.limit)
                blow_up(13, selector & 0xfffc);
            mem8_loc = (sa.base + Rb) & -1;
            Yd = Cb();
            mem8_loc += 4;
            Wd = Cb();
            if ((Wd & (1 << 12)) || ((Wd >> 8) & 0xf) != 2)
                blow_up(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                blow_up(11, selector & 0xfffc);
            be(cpu.ldt, Yd, Wd);
        }
        cpu.ldt.selector = selector;
    }
    function Ee(selector) {
        var sa, Yd, Wd, Rb, ie, De;
        selector &= 0xffff;
        if ((selector & 0xfffc) == 0) {
            cpu.tr.base = 0;
            cpu.tr.limit = 0;
            cpu.tr.flags = 0;
        } else {
            if (selector & 0x4)
                blow_up(13, selector & 0xfffc);
            sa = cpu.gdt;
            Rb = selector & ~7;
            De = 7;
            if ((Rb + De) > sa.limit)
                blow_up(13, selector & 0xfffc);
            mem8_loc = (sa.base + Rb) & -1;
            Yd = Cb();
            mem8_loc += 4;
            Wd = Cb();
            ie = (Wd >> 8) & 0xf;
            if ((Wd & (1 << 12)) || (ie != 1 && ie != 9))
                blow_up(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                blow_up(11, selector & 0xfffc);
            be(cpu.tr, Yd, Wd);
            Wd |= (1 << 9);
            Ib(Wd);
        }
        cpu.tr.selector = selector;
    }
    function Fe(Ge, selector) {
        var Yd, Wd, se, he, He, sa, Rb;
        se = cpu.cpl;
        if ((selector & 0xfffc) == 0) {
            if (Ge == 2)
                blow_up(13, 0);
            set_segment_vars(Ge, selector, 0, 0, 0);
        } else {
            if (selector & 0x4)
                sa = cpu.ldt;
            else
                sa = cpu.gdt;
            Rb = selector & ~7;
            if ((Rb + 7) > sa.limit)
                blow_up(13, selector & 0xfffc);
            mem8_loc = (sa.base + Rb) & -1;
            Yd = Cb();
            mem8_loc += 4;
            Wd = Cb();
            if (!(Wd & (1 << 12)))
                blow_up(13, selector & 0xfffc);
            He = selector & 3;
            he = (Wd >> 13) & 3;
            if (Ge == 2) {
                if ((Wd & (1 << 11)) || !(Wd & (1 << 9)))
                    blow_up(13, selector & 0xfffc);
                if (He != se || he != se)
                    blow_up(13, selector & 0xfffc);
            } else {
                if ((Wd & ((1 << 11) | (1 << 9))) == (1 << 11))
                    blow_up(13, selector & 0xfffc);
                if (!(Wd & (1 << 11)) || !(Wd & (1 << 10))) {
                    if (he < se || he < He)
                        blow_up(13, selector & 0xfffc);
                }
            }
            if (!(Wd & (1 << 15))) {
                if (Ge == 2)
                    blow_up(12, selector & 0xfffc);
                else
                    blow_up(11, selector & 0xfffc);
            }
            if (!(Wd & (1 << 8))) {
                Wd |= (1 << 8);
                Ib(Wd);
            }
            set_segment_vars(Ge, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        }
    }
    function Ie(Ge, selector) {
        var sa;
        selector &= 0xffff;
        if (!(cpu.cr0 & (1 << 0))) {
            sa = cpu.segs[Ge];
            sa.selector = selector;
            sa.base = selector << 4;
        } else if (cpu.eflags & 0x00020000) {
            init_segment_vars_with_selector(Ge, selector);
        } else {
            Fe(Ge, selector);
        }
    }
    function Je(Ke, Le) {
        eip = Le, mem_ptr = initial_mem_ptr = 0;
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        init_segment_local_vars();
    }
    function Me(Ke, Le) {
        var Ne, ie, Yd, Wd, se, he, He, limit, e;
        if ((Ke & 0xfffc) == 0)
            blow_up(13, 0);
        e = Xd(Ke);
        if (!e)
            blow_up(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        se = cpu.cpl;
        if (Wd & (1 << 12)) {
            if (!(Wd & (1 << 11)))
                blow_up(13, Ke & 0xfffc);
            he = (Wd >> 13) & 3;
            if (Wd & (1 << 10)) {
                if (he > se)
                    blow_up(13, Ke & 0xfffc);
            } else {
                He = Ke & 3;
                if (He > se)
                    blow_up(13, Ke & 0xfffc);
                if (he != se)
                    blow_up(13, Ke & 0xfffc);
            }
            if (!(Wd & (1 << 15)))
                blow_up(11, Ke & 0xfffc);
            limit = Zd(Yd, Wd);
            if ((Le >>> 0) > (limit >>> 0))
                blow_up(13, Ke & 0xfffc);
            set_segment_vars(1, (Ke & 0xfffc) | se, ae(Yd, Wd), limit, Wd);
            eip = Le, mem_ptr = initial_mem_ptr = 0;
        } else {
            cpu_abort("unsupported jump to call or task gate");
        }
    }
    function Oe(Ke, Le) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            Je(Ke, Le);
        } else {
            Me(Ke, Le);
        }
    }
    function Pe(Ge, se) {
        var he, Wd;
        if ((Ge == 4 || Ge == 5) && (cpu.segs[Ge].selector & 0xfffc) == 0)
            return;
        Wd = cpu.segs[Ge].flags;
        he = (Wd >> 13) & 3;
        if (!(Wd & (1 << 11)) || !(Wd & (1 << 10))) {
            if (he < se) {
                set_segment_vars(Ge, 0, 0, 0, 0);
            }
        }
    }
    function Qe(je, Ke, Le, oe) {
        var le;
        le = regs[4];
        if (je) {
            {
                le = (le - 4) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                wb(cpu.segs[1].selector);
            }
            {
                le = (le - 4) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                wb(oe);
            }
        } else {
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                ub(cpu.segs[1].selector);
            }
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                ub(oe);
            }
        }
        regs[4] = (regs[4] & ~SS_mask) | ((le) & SS_mask);
        eip = Le, mem_ptr = initial_mem_ptr = 0;
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        init_segment_local_vars();
    }
    function Re(je, Ke, Le, oe) {
        var ue, i, e;
        var Yd, Wd, se, he, He, selector, ve, Se;
        var ke, we, xe, Te, ie, re, SS_mask;
        var x, limit, Ue;
        var qe, Ve, We;
        if ((Ke & 0xfffc) == 0)
            blow_up(13, 0);
        e = Xd(Ke);
        if (!e)
            blow_up(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        se = cpu.cpl;
        We = regs[4];
        if (Wd & (1 << 12)) {
            if (!(Wd & (1 << 11)))
                blow_up(13, Ke & 0xfffc);
            he = (Wd >> 13) & 3;
            if (Wd & (1 << 10)) {
                if (he > se)
                    blow_up(13, Ke & 0xfffc);
            } else {
                He = Ke & 3;
                if (He > se)
                    blow_up(13, Ke & 0xfffc);
                if (he != se)
                    blow_up(13, Ke & 0xfffc);
            }
            if (!(Wd & (1 << 15)))
                blow_up(11, Ke & 0xfffc);
            {
                Te = We;
                SS_mask = SS_mask_from_flags(cpu.segs[2].flags);
                qe = cpu.segs[2].base;
                if (je) {
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Ib(cpu.segs[1].selector);
                    }
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Ib(oe);
                    }
                } else {
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Gb(cpu.segs[1].selector);
                    }
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Gb(oe);
                    }
                }
                limit = Zd(Yd, Wd);
                if (Le > limit)
                    blow_up(13, Ke & 0xfffc);
                regs[4] = (regs[4] & ~SS_mask) | ((Te) & SS_mask);
                set_segment_vars(1, (Ke & 0xfffc) | se, ae(Yd, Wd), limit, Wd);
                eip = Le, mem_ptr = initial_mem_ptr = 0;
            }
        } else {
            ie = (Wd >> 8) & 0x1f;
            he = (Wd >> 13) & 3;
            He = Ke & 3;
            switch (ie) {
                case 1:
                case 9:
                case 5:
                    throw "unsupported task gate";
                    return;
                case 4:
                case 12:
                    break;
                default:
                    blow_up(13, Ke & 0xfffc);
                    break;
            }
            je = ie >> 3;
            if (he < se || he < He)
                blow_up(13, Ke & 0xfffc);
            if (!(Wd & (1 << 15)))
                blow_up(11, Ke & 0xfffc);
            selector = Yd >> 16;
            ve = (Wd & 0xffff0000) | (Yd & 0x0000ffff);
            Se = Wd & 0x1f;
            if ((selector & 0xfffc) == 0)
                blow_up(13, 0);
            e = Xd(selector);
            if (!e)
                blow_up(13, selector & 0xfffc);
            Yd = e[0];
            Wd = e[1];
            if (!(Wd & (1 << 12)) || !(Wd & ((1 << 11))))
                blow_up(13, selector & 0xfffc);
            he = (Wd >> 13) & 3;
            if (he > se)
                blow_up(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                blow_up(11, selector & 0xfffc);
            if (!(Wd & (1 << 10)) && he < se) {
                e = ge(he);
                ke = e[0];
                Te = e[1];
                if ((ke & 0xfffc) == 0)
                    blow_up(10, ke & 0xfffc);
                if ((ke & 3) != he)
                    blow_up(10, ke & 0xfffc);
                e = Xd(ke);
                if (!e)
                    blow_up(10, ke & 0xfffc);
                we = e[0];
                xe = e[1];
                re = (xe >> 13) & 3;
                if (re != he)
                    blow_up(10, ke & 0xfffc);
                if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                    blow_up(10, ke & 0xfffc);
                if (!(xe & (1 << 15)))
                    blow_up(10, ke & 0xfffc);
                Ue = SS_mask_from_flags(cpu.segs[2].flags);
                Ve = cpu.segs[2].base;
                SS_mask = SS_mask_from_flags(xe);
                qe = ae(we, xe);
                if (je) {
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Ib(cpu.segs[2].selector);
                    }
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Ib(We);
                    }
                    for (i = Se - 1; i >= 0; i--) {
                        x = Xe(Ve + ((We + i * 4) & Ue));
                        {
                            Te = (Te - 4) & -1;
                            mem8_loc = (qe + (Te & SS_mask)) & -1;
                            Ib(x);
                        }
                    }
                } else {
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Gb(cpu.segs[2].selector);
                    }
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        Gb(We);
                    }
                    for (i = Se - 1; i >= 0; i--) {
                        x = Ye(Ve + ((We + i * 2) & Ue));
                        {
                            Te = (Te - 2) & -1;
                            mem8_loc = (qe + (Te & SS_mask)) & -1;
                            Gb(x);
                        }
                    }
                }
                ue = 1;
            } else {
                Te = We;
                SS_mask = SS_mask_from_flags(cpu.segs[2].flags);
                qe = cpu.segs[2].base;
                ue = 0;
            }
            if (je) {
                {
                    Te = (Te - 4) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    Ib(cpu.segs[1].selector);
                }
                {
                    Te = (Te - 4) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    Ib(oe);
                }
            } else {
                {
                    Te = (Te - 2) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    Gb(cpu.segs[1].selector);
                }
                {
                    Te = (Te - 2) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    Gb(oe);
                }
            }
            if (ue) {
                ke = (ke & ~3) | he;
                set_segment_vars(2, ke, qe, Zd(we, xe), xe);
            }
            selector = (selector & ~3) | he;
            set_segment_vars(1, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
            change_permission_level(he);
            regs[4] = (regs[4] & ~SS_mask) | ((Te) & SS_mask);
            eip = ve, mem_ptr = initial_mem_ptr = 0;
        }
    }
    function Ze(je, Ke, Le, oe) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            Qe(je, Ke, Le, oe);
        } else {
            Re(je, Ke, Le, oe);
        }
    }
    function af(je, bf, cf) {
        var Te, Ke, Le, df, SS_mask, qe, ef;
        SS_mask = 0xffff;
        Te = regs[4];
        qe = cpu.segs[2].base;
        if (je == 1) {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = Cb();
                Te = (Te + 4) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = Cb();
                Te = (Te + 4) & -1;
            }
            Ke &= 0xffff;
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = Cb();
                Te = (Te + 4) & -1;
            }
        } else {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = Ab();
                Te = (Te + 2) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = Ab();
                Te = (Te + 2) & -1;
            }
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = Ab();
                Te = (Te + 2) & -1;
            }
        }
        regs[4] = (regs[4] & ~SS_mask) | ((Te + cf) & SS_mask);
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        eip = Le, mem_ptr = initial_mem_ptr = 0;
        if (bf) {
            if (cpu.eflags & 0x00020000)
                ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00010000 | 0x00004000;
            else
                ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00003000 | 0x00010000 | 0x00004000;
            if (je == 0)
                ef &= 0xffff;
            kd(df, ef);
        }
        init_segment_local_vars();
    }
    function ff(je, bf, cf) {
        var Ke, df, gf;
        var hf, jf, kf, lf;
        var e, Yd, Wd, we, xe;
        var se, he, He, ef, Sa;
        var qe, Te, Le, wd, SS_mask;
        SS_mask = SS_mask_from_flags(cpu.segs[2].flags);
        Te = regs[4];
        qe = cpu.segs[2].base;
        df = 0;
        if (je == 1) {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = Cb();
                Te = (Te + 4) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = Cb();
                Te = (Te + 4) & -1;
            }
            Ke &= 0xffff;
            if (bf) {
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    df = Cb();
                    Te = (Te + 4) & -1;
                }
                if (df & 0x00020000) {
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        wd = Cb();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        gf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        hf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        jf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        kf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        lf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    kd(df, 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00003000 | 0x00020000 | 0x00004000 | 0x00080000 | 0x00100000);
                    init_segment_vars_with_selector(1, Ke & 0xffff);
                    change_permission_level(3);
                    init_segment_vars_with_selector(2, gf & 0xffff);
                    init_segment_vars_with_selector(0, hf & 0xffff);
                    init_segment_vars_with_selector(3, jf & 0xffff);
                    init_segment_vars_with_selector(4, kf & 0xffff);
                    init_segment_vars_with_selector(5, lf & 0xffff);
                    eip = Le & 0xffff, mem_ptr = initial_mem_ptr = 0;
                    regs[4] = (regs[4] & ~SS_mask) | ((wd) & SS_mask);
                    return;
                }
            }
        } else {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = Ab();
                Te = (Te + 2) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = Ab();
                Te = (Te + 2) & -1;
            }
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = Ab();
                Te = (Te + 2) & -1;
            }
        }
        if ((Ke & 0xfffc) == 0)
            blow_up(13, Ke & 0xfffc);
        e = Xd(Ke);
        if (!e)
            blow_up(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)) || !(Wd & (1 << 11)))
            blow_up(13, Ke & 0xfffc);
        se = cpu.cpl;
        He = Ke & 3;
        if (He < se)
            blow_up(13, Ke & 0xfffc);
        he = (Wd >> 13) & 3;
        if (Wd & (1 << 10)) {
            if (he > He)
                blow_up(13, Ke & 0xfffc);
        } else {
            if (he != He)
                blow_up(13, Ke & 0xfffc);
        }
        if (!(Wd & (1 << 15)))
            blow_up(11, Ke & 0xfffc);
        Te = (Te + cf) & -1;
        if (He == se) {
            set_segment_vars(1, Ke, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        } else {
            if (je == 1) {
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    wd = Cb();
                    Te = (Te + 4) & -1;
                }
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    gf = Cb();
                    Te = (Te + 4) & -1;
                }
                gf &= 0xffff;
            } else {
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    wd = Ab();
                    Te = (Te + 2) & -1;
                }
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    gf = Ab();
                    Te = (Te + 2) & -1;
                }
            }
            if ((gf & 0xfffc) == 0) {
                blow_up(13, 0);
            } else {
                if ((gf & 3) != He)
                    blow_up(13, gf & 0xfffc);
                e = Xd(gf);
                if (!e)
                    blow_up(13, gf & 0xfffc);
                we = e[0];
                xe = e[1];
                if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                    blow_up(13, gf & 0xfffc);
                he = (xe >> 13) & 3;
                if (he != He)
                    blow_up(13, gf & 0xfffc);
                if (!(xe & (1 << 15)))
                    blow_up(11, gf & 0xfffc);
                set_segment_vars(2, gf, ae(we, xe), Zd(we, xe), xe);
            }
            set_segment_vars(1, Ke, ae(Yd, Wd), Zd(Yd, Wd), Wd);
            change_permission_level(He);
            Te = wd;
            SS_mask = SS_mask_from_flags(xe);
            Pe(0, He);
            Pe(3, He);
            Pe(4, He);
            Pe(5, He);
            Te = (Te + cf) & -1;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((Te) & SS_mask);
        eip = Le, mem_ptr = initial_mem_ptr = 0;
        if (bf) {
            ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00010000 | 0x00004000;
            if (se == 0)
                ef |= 0x00003000;
            Sa = (cpu.eflags >> 12) & 3;
            if (se <= Sa)
                ef |= 0x00000200;
            if (je == 0)
                ef &= 0xffff;
            kd(df, ef);
        }
    }
    function mf(je) {
        var Sa;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            if (cpu.eflags & 0x00020000) {
                Sa = (cpu.eflags >> 12) & 3;
                if (Sa != 3)
                    blow_up_errcode0(13);
            }
            af(je, 1, 0);
        } else {
            if (cpu.eflags & 0x00004000) {
                throw "unsupported task gate";
            } else {
                ff(je, 1, 0);
            }
        }
    }
    function nf(je, cf) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            af(je, 0, cf);
        } else {
            ff(je, 0, cf);
        }
    }
    function of(selector, pf) {
        var e, Yd, Wd, He, he, se, ie;
        if ((selector & 0xfffc) == 0)
            return null;
        e = Xd(selector);
        if (!e)
            return null;
        Yd = e[0];
        Wd = e[1];
        He = selector & 3;
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (Wd & (1 << 12)) {
            if ((Wd & (1 << 11)) && (Wd & (1 << 10))) {
            } else {
                if (he < se || he < He)
                    return null;
            }
        } else {
            ie = (Wd >> 8) & 0xf;
            switch (ie) {
                case 1:
                case 2:
                case 3:
                case 9:
                case 11:
                    break;
                case 4:
                case 5:
                case 12:
                    if (pf)
                        return null;
                    break;
                default:
                    return null;
            }
            if (he < se || he < He)
                return null;
        }
        if (pf) {
            return Zd(Yd, Wd);
        } else {
            return Wd & 0x00f0ff00;
        }
    }
    function qf(je, pf) {
        var x, mem8, register_1, selector;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
            blow_up_errcode0(6);
        mem8 = phys_mem8[mem_ptr++];
        register_1 = (mem8 >> 3) & 7;
        if ((mem8 >> 6) == 3) {
            selector = regs[mem8 & 7] & 0xffff;
        } else {
            mem8_loc = Pb(mem8);
            selector = ld_16bits_mem8_read();
        }
        x = of(selector, pf);
        _src = hd();
        if (x === null) {
            _src &= ~0x0040;
        } else {
            _src |= 0x0040;
            if (je)
                regs[register_1] = x;
            else
                set_lower_two_bytes_of_register(register_1, x);
        }
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function rf(selector, ud) {
        var e, Yd, Wd, He, he, se;
        if ((selector & 0xfffc) == 0)
            return 0;
        e = Xd(selector);
        if (!e)
            return 0;
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)))
            return 0;
        He = selector & 3;
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (Wd & (1 << 11)) {
            if (ud) {
                return 0;
            } else {
                if (!(Wd & (1 << 9)))
                    return 1;
                if (!(Wd & (1 << 10))) {
                    if (he < se || he < He)
                        return 0;
                }
            }
        } else {
            if (he < se || he < He)
                return 0;
            if (ud && !(Wd & (1 << 9)))
                return 0;
        }
        return 1;
    }
    function sf(selector, ud) {
        var z;
        z = rf(selector, ud);
        _src = hd();
        if (z)
            _src |= 0x0040;
        else
            _src &= ~0x0040;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function tf() {
        var mem8, x, Ha, register_0;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
            blow_up_errcode0(6);
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 6) == 3) {
            register_0 = mem8 & 7;
            x = regs[register_0] & 0xffff;
        } else {
            mem8_loc = Pb(mem8);
            x = ld_16bits_mem8_write();
        }
        Ha = regs[(mem8 >> 3) & 7];
        _src = hd();
        if ((x & 3) < (Ha & 3)) {
            x = (x & ~3) | (Ha & 3);
            if ((mem8 >> 6) == 3) {
                set_lower_two_bytes_of_register(register_0, x);
            } else {
                ub(x);
            }
            _src |= 0x0040;
        } else {
            _src &= ~0x0040;
        }
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function uf() {
        var Rb;
        Rb = regs[0];
        switch (Rb) {
            case 0:
                regs[0] = 1;
                regs[3] = 0x756e6547 & -1;
                regs[2] = 0x49656e69 & -1;
                regs[1] = 0x6c65746e & -1;
                break;
            case 1:
            default:
                regs[0] = (5 << 8) | (4 << 4) | 3;
                regs[3] = 8 << 8;
                regs[1] = 0;
                regs[2] = (1 << 4);
                break;
        }
    }
    function vf(base) {
        var wf, xf;
        if (base == 0)
            blow_up_errcode0(0);
        wf = regs[0] & 0xff;
        xf = (wf / base) & -1;
        wf = (wf % base);
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _dst = (((wf) << 24) >> 24);
        _op = 12;
    }
    function yf(base) {
        var wf, xf;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        wf = (xf * base + wf) & 0xff;
        regs[0] = (regs[0] & ~0xffff) | wf;
        _dst = (((wf) << 24) >> 24);
        _op = 12;
    }
    function zf() {
        var Af, wf, xf, Bf, jd;
        jd = hd();
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        Af = (wf > 0xf9);
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf + 6) & 0x0f;
            xf = (xf + 1 + Af) & 0xff;
            jd |= 0x0001 | 0x0010;
        } else {
            jd &= ~(0x0001 | 0x0010);
            wf &= 0x0f;
        }
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Cf() {
        var Af, wf, xf, Bf, jd;
        jd = hd();
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        Af = (wf < 6);
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf - 6) & 0x0f;
            xf = (xf - 1 - Af) & 0xff;
            jd |= 0x0001 | 0x0010;
        } else {
            jd &= ~(0x0001 | 0x0010);
            wf &= 0x0f;
        }
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Df() {
        var wf, Bf, Ef, jd;
        jd = hd();
        Ef = jd & 0x0001;
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        jd = 0;
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf + 6) & 0xff;
            jd |= 0x0010;
        }
        if ((wf > 0x9f) || Ef) {
            wf = (wf + 0x60) & 0xff;
            jd |= 0x0001;
        }
        regs[0] = (regs[0] & ~0xff) | wf;
        jd |= (wf == 0) << 6;
        jd |= parity_bit_check_array[wf] << 2;
        jd |= (wf & 0x80);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Ff() {
        var wf, Gf, Bf, Ef, jd;
        jd = hd();
        Ef = jd & 0x0001;
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        jd = 0;
        Gf = wf;
        if (((wf & 0x0f) > 9) || Bf) {
            jd |= 0x0010;
            if (wf < 6 || Ef)
                jd |= 0x0001;
            wf = (wf - 6) & 0xff;
        }
        if ((Gf > 0x99) || Ef) {
            wf = (wf - 0x60) & 0xff;
            jd |= 0x0001;
        }
        regs[0] = (regs[0] & ~0xff) | wf;
        jd |= (wf == 0) << 6;
        jd |= parity_bit_check_array[wf] << 2;
        jd |= (wf & 0x80);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Hf() {
        var mem8, x, Ha, Ia;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = Pb(mem8);
        x = ld_32bits_mem8_read();
        mem8_loc = (mem8_loc + 4) & -1;
        Ha = ld_32bits_mem8_read();
        register_1 = (mem8 >> 3) & 7;
        Ia = regs[register_1];
        if (Ia < x || Ia > Ha)
            blow_up_errcode0(5);
    }
    function If() {
        var mem8, x, Ha, Ia;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = Pb(mem8);
        x = (ld_16bits_mem8_read() << 16) >> 16;
        mem8_loc = (mem8_loc + 2) & -1;
        Ha = (ld_16bits_mem8_read() << 16) >> 16;
        register_1 = (mem8 >> 3) & 7;
        Ia = (regs[register_1] << 16) >> 16;
        if (Ia < x || Ia > Ha)
            blow_up_errcode0(5);
    }
    function Jf() {
        var x, Ha, register_1;
        Ha = (regs[4] - 16) >> 0;
        mem8_loc = ((Ha & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            x = regs[register_1];
            ub(x);
            mem8_loc = (mem8_loc + 2) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((Ha) & SS_mask);
    }
    function Kf() {
        var x, Ha, register_1;
        Ha = (regs[4] - 32) >> 0;
        mem8_loc = ((Ha & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            x = regs[register_1];
            wb(x);
            mem8_loc = (mem8_loc + 4) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((Ha) & SS_mask);
    }
    function Lf() {
        var register_1;
        mem8_loc = ((regs[4] & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            if (register_1 != 4) {
                set_lower_two_bytes_of_register(register_1, ld_16bits_mem8_read());
            }
            mem8_loc = (mem8_loc + 2) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 16) & SS_mask);
    }
    function Mf() {
        var register_1;
        mem8_loc = ((regs[4] & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            if (register_1 != 4) {
                regs[register_1] = ld_32bits_mem8_read();
            }
            mem8_loc = (mem8_loc + 4) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 32) & SS_mask);
    }
    function Nf() {
        var x, Ha;
        Ha = regs[5];
        mem8_loc = ((Ha & SS_mask) + SS_base) >> 0;
        x = ld_16bits_mem8_read();
        set_lower_two_bytes_of_register(5, x);
        regs[4] = (regs[4] & ~SS_mask) | ((Ha + 2) & SS_mask);
    }
    function Of() {
        var x, Ha;
        Ha = regs[5];
        mem8_loc = ((Ha & SS_mask) + SS_base) >> 0;
        x = ld_32bits_mem8_read();
        regs[5] = x;
        regs[4] = (regs[4] & ~SS_mask) | ((Ha + 4) & SS_mask);
    }
    function Pf() {
        var cf, Qf, le, Rf, x, Sf;
        cf = Ob();
        Qf = phys_mem8[mem_ptr++];
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            ub(Rf);
        }
        Sf = le;
        if (Qf != 0) {
            while (Qf > 1) {
                Rf = (Rf - 2) >> 0;
                mem8_loc = ((Rf & SS_mask) + SS_base) >> 0;
                x = ld_16bits_mem8_read();
                {
                    le = (le - 2) >> 0;
                    mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                    ub(x);
                }
                Qf--;
            }
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                ub(Sf);
            }
        }
        le = (le - cf) >> 0;
        mem8_loc = ((le & SS_mask) + SS_base) >> 0;
        ld_16bits_mem8_write();
        regs[5] = (regs[5] & ~SS_mask) | (Sf & SS_mask);
        regs[4] = le;
    }
    function Tf() {
        var cf, Qf, le, Rf, x, Sf;
        cf = Ob();
        Qf = phys_mem8[mem_ptr++];
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 4) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            wb(Rf);
        }
        Sf = le;
        if (Qf != 0) {
            while (Qf > 1) {
                Rf = (Rf - 4) >> 0;
                mem8_loc = ((Rf & SS_mask) + SS_base) >> 0;
                x = ld_32bits_mem8_read();
                {
                    le = (le - 4) >> 0;
                    mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                    wb(x);
                }
                Qf--;
            }
            {
                le = (le - 4) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                wb(Sf);
            }
        }
        le = (le - cf) >> 0;
        mem8_loc = ((le & SS_mask) + SS_base) >> 0;
        ld_32bits_mem8_write();
        regs[5] = (regs[5] & ~SS_mask) | (Sf & SS_mask);
        regs[4] = (regs[4] & ~SS_mask) | ((le) & SS_mask);
    }
    function Uf(Sb) {
        var x, Ha, mem8;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = Pb(mem8);
        x = ld_32bits_mem8_read();
        mem8_loc += 4;
        Ha = ld_16bits_mem8_read();
        Ie(Sb, Ha);
        regs[(mem8 >> 3) & 7] = x;
    }
    function Vf(Sb) {
        var x, Ha, mem8;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = Pb(mem8);
        x = ld_16bits_mem8_read();
        mem8_loc += 2;
        Ha = ld_16bits_mem8_read();
        Ie(Sb, Ha);
        set_lower_two_bytes_of_register((mem8 >> 3) & 7, x);
    }
    function Wf() {
        var Xf, Yf, Zf, ag, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = cpu.ld8_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            sb(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld8_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            sb(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function bg() {
        var Xf, cg, Sb, ag, Zf, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_8bits_mem8_read();
            cpu.st8_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_8bits_mem8_read();
            cpu.st8_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
        }
    }
    function dg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            {
                x = ld_8bits_mem8_read();
                mem8_loc = eg;
                sb(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_8bits_mem8_read();
            mem8_loc = eg;
            sb(x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function fg() {
        var Xf, Yf, ag;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            {
                sb(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            sb(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function gg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_8bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_8bits_mem8_read();
            do_8bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_8bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_8bits_mem8_read();
            do_8bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function hg() {
        var Xf, cg, Sb, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_8bits_mem8_read();
            regs[0] = (regs[0] & -256) | x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_8bits_mem8_read();
            regs[0] = (regs[0] & -256) | x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
        }
    }
    function ig() {
        var Xf, Yf, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_8bits_mem8_read();
            do_8bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_8bits_mem8_read();
            do_8bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function jg() {
        var Xf, Yf, Zf, ag, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = cpu.ld16_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            ub(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld16_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            ub(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function kg() {
        var Xf, cg, Sb, ag, Zf, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_16bits_mem8_read();
            cpu.st16_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_16bits_mem8_read();
            cpu.st16_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
        }
    }
    function lg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            {
                x = ld_16bits_mem8_read();
                mem8_loc = eg;
                ub(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_16bits_mem8_read();
            mem8_loc = eg;
            ub(x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function mg() {
        var Xf, Yf, ag;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            {
                ub(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            ub(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function ng() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_16bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_16bits_mem8_read();
            do_16bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_16bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_16bits_mem8_read();
            do_16bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function og() {
        var Xf, cg, Sb, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_16bits_mem8_read();
            regs[0] = (regs[0] & -65536) | x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_16bits_mem8_read();
            regs[0] = (regs[0] & -65536) | x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
        }
    }
    function pg() {
        var Xf, Yf, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_16bits_mem8_read();
            do_16bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_16bits_mem8_read();
            do_16bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function qg() {
        var Xf, Yf, Zf, ag, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = cpu.ld32_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            wb(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld32_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            wb(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function rg() {
        var Xf, cg, Sb, ag, Zf, Sa, x;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            blow_up_errcode0(13);
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_32bits_mem8_read();
            cpu.st32_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            x = ld_32bits_mem8_read();
            cpu.st32_port(Zf, x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
        }
    }
    function sg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            if (Xf == -1 && cpu.df == 1 && ((mem8_loc | eg) & 3) == 0) {
                var tg, l, ug, vg, i, wg;
                tg = ag >>> 0;
                l = (4096 - (mem8_loc & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                l = (4096 - (eg & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                ug = td(mem8_loc, 0);
                vg = td(eg, 1);
                wg = tg << 2;
                vg >>= 2;
                ug >>= 2;
                for (i = 0; i < tg; i++)
                    phys_mem32[vg + i] = phys_mem32[ug + i];
                regs[6] = (cg + wg) >> 0;
                regs[7] = (Yf + wg) >> 0;
                regs[1] = ag = (ag - tg) >> 0;
                if (ag)
                    mem_ptr = initial_mem_ptr;
            } else {
                x = ld_32bits_mem8_read();
                mem8_loc = eg;
                wb(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_32bits_mem8_read();
            mem8_loc = eg;
            wb(x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function xg() {
        var Xf, Yf, ag;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            if (Xf == -1 && cpu.df == 1 && (mem8_loc & 3) == 0) {
                var tg, l, vg, i, wg, x;
                tg = ag >>> 0;
                l = (4096 - (mem8_loc & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                vg = td(regs[7], 1);
                x = regs[0];
                vg >>= 2;
                for (i = 0; i < tg; i++)
                    phys_mem32[vg + i] = x;
                wg = tg << 2;
                regs[7] = (Yf + wg) >> 0;
                regs[1] = ag = (ag - tg) >> 0;
                if (ag)
                    mem_ptr = initial_mem_ptr;
            } else {
                wb(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            wb(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function yg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_32bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_32bits_mem8_read();
            do_32bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_32bits_mem8_read();
            mem8_loc = eg;
            Ha = ld_32bits_mem8_read();
            do_32bit_math(7, x, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function zg() {
        var Xf, cg, Sb, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = CS_flags & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        mem8_loc = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_32bits_mem8_read();
            regs[0] = x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_32bits_mem8_read();
            regs[0] = x;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
        }
    }
    function Ag() {
        var Xf, Yf, ag, x;
        if (CS_flags & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (CS_flags & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            x = ld_32bits_mem8_read();
            do_32bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (CS_flags & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = ld_32bits_mem8_read();
            do_32bit_math(7, regs[0], x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }

    cpu = this;
    phys_mem8 = this.phys_mem8;
    phys_mem16 = this.phys_mem16;
    phys_mem32 = this.phys_mem32;
    tlb_read_user = this.tlb_read_user;
    tlb_write_user = this.tlb_write_user;
    tlb_read_kernel = this.tlb_read_kernel;
    tlb_write_kernel = this.tlb_write_kernel;
    if (cpu.cpl == 3) {  //current privilege level
        _tlb_read_ = tlb_read_user;
        _tlb_write_ = tlb_write_user;
    } else {
        _tlb_read_ = tlb_read_kernel;
        _tlb_write_ = tlb_write_kernel;
    }
    if (cpu.halted) {
        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200)) {
            cpu.halted = 0;
        } else {
            return 257;
        }
    }
    regs = this.regs;
    _src = this.cc_src;
    _dst = this.cc_dst;
    _op = this.cc_op;
    _op2 = this.cc_op2;
    _dst2 = this.cc_dst2;
    eip = this.eip;
    init_segment_local_vars();
    La = 256;
    cycles_left = N_cycles;
    if (va) {
        Ae(va.intno, 0, va.error_code, 0, 0);
    }
    if (cpu.hard_intno >= 0) {
        Ae(cpu.hard_intno, 0, 0, 0, 1);
        cpu.hard_intno = -1;
    }
    if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200)) {
        cpu.hard_intno = cpu.get_hard_intno();
        Ae(cpu.hard_intno, 0, 0, 0, 1);
        cpu.hard_intno = -1;
    }
    mem_ptr = 0;
    initial_mem_ptr = 0;

    Bg: do {
        eip = (eip + mem_ptr - initial_mem_ptr) >> 0;
        Nb = (eip + CS_base) >> 0;
        Lb = _tlb_read_[Nb >>> 12];
        if (((Lb | Nb) & 0xfff) >= (4096 - 15 + 1)) {
            var Cg;
            if (Lb == -1)
                do_tlb_set_page(Nb, 0, cpu.cpl == 3);
            Lb = _tlb_read_[Nb >>> 12];
            initial_mem_ptr = mem_ptr = Nb ^ Lb;
            OPbyte = phys_mem8[mem_ptr++];
            Cg = Nb & 0xfff;
            if (Cg >= (4096 - 15 + 1)) {
                x = Cd(Nb, OPbyte);
                if ((Cg + x) > 4096) {
                    initial_mem_ptr = mem_ptr = this.mem_size;
                    for (Ha = 0; Ha < x; Ha++) {
                        mem8_loc = (Nb + Ha) >> 0;
                        phys_mem8[mem_ptr + Ha] = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    mem_ptr++;
                }
            }
        } else {
            initial_mem_ptr = mem_ptr = Nb ^ Lb;
            OPbyte = phys_mem8[mem_ptr++];
        }
        OPbyte |= (CS_flags = init_CS_flags) & 0x0100;
        Fd: for (; ; ) {
            switch (OPbyte) {
                case 0x66://Operand-size override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    if (init_CS_flags & 0x0100)
                        CS_flags &= ~0x0100;
                    else
                        CS_flags |= 0x0100;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x67://Address-size override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    if (init_CS_flags & 0x0080)
                        CS_flags &= ~0x0080;
                    else
                        CS_flags |= 0x0080;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf0://LOCK  Assert LOCK# Signal Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0040;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf2://REPNZ  Repeat String Operation Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0020;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf3://REPZ  Repeat String Operation Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0010;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x26://ES  ES segment override prefix
                case 0x2e://CS  CS segment override prefix
                case 0x36://SS  SS segment override prefix
                case 0x3e://DS  DS segment override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags = (CS_flags & ~0x000f) | (((OPbyte >> 3) & 3) + 1);
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x64://FS  FS segment override prefix
                case 0x65://GS  GS segment override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags = (CS_flags & ~0x000f) | ((OPbyte & 7) + 1);
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xb0://B0+r  MOV  r8  imm8
                case 0xb1:
                case 0xb2:
                case 0xb3:
                case 0xb4:
                case 0xb5:
                case 0xb6:
                case 0xb7:
                    x = phys_mem8[mem_ptr++]; //r8
                    OPbyte &= 7; //last bits
                    last_tlb_val = (OPbyte & 4) << 1;
                    regs[OPbyte & 3] = (regs[OPbyte & 3] & ~(0xff << last_tlb_val)) | (((x) & 0xff) << last_tlb_val);
                    break Fd;
                case 0xb8://B8+r  MOV  r16/32   imm16/32
                case 0xb9:
                case 0xba:
                case 0xbb:
                case 0xbc:
                case 0xbd:
                case 0xbe:
                case 0xbf:
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    regs[OPbyte & 7] = x;
                    break Fd;
                case 0x88://MOV  r/m8   r8
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    x = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        last_tlb_val = (register_0 & 4) << 1;
                        regs[register_0 & 3] = (regs[register_0 & 3] & ~(0xff << last_tlb_val)) | (((x) & 0xff) << last_tlb_val);
                    } else {
                        mem8_loc = Pb(mem8);
                        {
                            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
                            if (last_tlb_val == -1) {
                                rb(x);
                            } else {
                                phys_mem8[mem8_loc ^ last_tlb_val] = x;
                            }
                        }
                    }
                    break Fd;
                case 0x89://MOV  r/m16/32  r16/32
                    mem8 = phys_mem8[mem_ptr++];
                    x = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        regs[mem8 & 7] = x;
                    } else {
                        mem8_loc = Pb(mem8);
                        {
                            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
                            if ((last_tlb_val | mem8_loc) & 3) {
                                vb(x);
                            } else {
                                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
                            }
                        }
                    }
                    break Fd;
                case 0x8a://MOV r8  r/m8
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = Pb(mem8);
                        x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    register_1 = (mem8 >> 3) & 7;
                    last_tlb_val = (register_1 & 4) << 1;
                    regs[register_1 & 3] = (regs[register_1 & 3] & ~(0xff << last_tlb_val)) | (((x) & 0xff) << last_tlb_val);
                    break Fd;
                case 0x8b://MOV r16/32  r/m16/32
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_read() : phys_mem32[(mem8_loc ^ last_tlb_val) >> 2]);
                    }
                    regs[(mem8 >> 3) & 7] = x;
                    break Fd;
                case 0xa0://MOV AL  moffs8
                    mem8_loc = Ub();
                    x = ld_8bits_mem8_read();
                    regs[0] = (regs[0] & -256) | x;
                    break Fd;
                case 0xa1://MOV eAX moffs16/32
                    mem8_loc = Ub();
                    x = ld_32bits_mem8_read();
                    regs[0] = x;
                    break Fd;
                case 0xa2://MOV moffs8  AL
                    mem8_loc = Ub();
                    sb(regs[0]);
                    break Fd;
                case 0xa3://MOV moffs16/32  eAX
                    mem8_loc = Ub();
                    wb(regs[0]);
                    break Fd;
                case 0xd7://XLAT    AL  m8    Table Look-up Translation
                    mem8_loc = (regs[3] + (regs[0] & 0xff)) >> 0;
                    if (CS_flags & 0x0080)
                        mem8_loc &= 0xffff;
                    register_1 = CS_flags & 0x000f;
                    if (register_1 == 0)
                        register_1 = 3;
                    else
                        register_1--;
                    mem8_loc = (mem8_loc + cpu.segs[register_1].base) >> 0;
                    x = ld_8bits_mem8_read();
                    set_either_two_bytes_of_reg_ABCD(0, x);
                    break Fd;
                case 0xc6://MOV r/m8    imm8
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = phys_mem8[mem_ptr++];
                        set_either_two_bytes_of_reg_ABCD(mem8 & 7, x);
                    } else {
                        mem8_loc = Pb(mem8);
                        x = phys_mem8[mem_ptr++];
                        sb(x);
                    }
                    break Fd;
                case 0xc7://MOV r/m16/32    imm16/32
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        regs[mem8 & 7] = x;
                    } else {
                        mem8_loc = Pb(mem8);
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        wb(x);
                    }
                    break Fd;
                case 0x91://(90+r)  XCHG  r16/32  eAX     Exchange Register/Memory with Register
                case 0x92:
                case 0x93:
                case 0x94:
                case 0x95:
                case 0x96:
                case 0x97:
                    register_1 = OPbyte & 7;
                    x = regs[0];
                    regs[0] = regs[register_1];
                    regs[register_1] = x;
                    break Fd;
                case 0x86://XCHG    r8  r/m8    Exchange Register/Memory with Register
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                        set_either_two_bytes_of_reg_ABCD(register_0, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_8bits_mem8_write();
                        sb((regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                    }
                    set_either_two_bytes_of_reg_ABCD(register_1, x);
                    break Fd;
                case 0x87://XCHG    r16/32  r/m16/32    Exchange Register/Memory with Register
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = regs[register_0];
                        regs[register_0] = regs[register_1];
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_write();
                        wb(regs[register_1]);
                    }
                    regs[register_1] = x;
                    break Fd;
                case 0x8e://MOV Sreg    r/m16    Move
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if (register_1 >= 6 || register_1 == 1)
                        blow_up_errcode0(6);
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7] & 0xffff;
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_16bits_mem8_read();
                    }
                    Ie(register_1, x);
                    break Fd;
                case 0x8c://MOV m16 Sreg   OR  MOV  r16/32  Sreg      Move
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if (register_1 >= 6)
                        blow_up_errcode0(6);
                    x = cpu.segs[register_1].selector;
                    if ((mem8 >> 6) == 3) {
                        if ((((CS_flags >> 8) & 1) ^ 1)) {
                            regs[mem8 & 7] = x;
                        } else {
                            set_lower_two_bytes_of_register(mem8 & 7, x);
                        }
                    } else {
                        mem8_loc = Pb(mem8);
                        ub(x);
                    }
                    break Fd;
                case 0xc4://LES   ES  r16/32  m16:16/32  Load Far Pointer
                    Uf(0);
                    break Fd;
                case 0xc5://LDS   DS  r16/32  m16:16/32  Load Far Pointer
                    Uf(3);
                    break Fd;
                case 0x00://ADD r/m8    r8   Add
                case 0x08://OR  r/m8    r8   Logical Inclusive OR
                case 0x10://ADC r/m8    r8   Add with Carry
                case 0x18://SBB r/m8    r8   Integer Subtraction with Borrow
                case 0x20://AND r/m8    r8   Logical AND
                case 0x28://SUB r/m8    r8   Subtract
                case 0x30://XOR r/m8    r8   Logical Exclusive OR
                case 0x38://CMP r/m8    r8   Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    Ha = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(Ja, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), Ha));
                    } else {
                        mem8_loc = Pb(mem8);
                        if (Ja != 7) {
                            x = ld_8bits_mem8_write();
                            x = do_8bit_math(Ja, x, Ha);
                            sb(x);
                        } else {
                            x = ld_8bits_mem8_read();
                            do_8bit_math(7, x, Ha);
                        }
                    }
                    break Fd;
                case 0x01://ADD	r/m16/32	r16/32  Add
                    mem8 = phys_mem8[mem_ptr++];
                    Ha = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        {
                            _src = Ha;
                            _dst = regs[register_0] = (regs[register_0] + _src) >> 0;
                            _op = 2;
                        }
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_write();
                        {
                            _src = Ha;
                            _dst = x = (x + _src) >> 0;
                            _op = 2;
                        }
                        wb(x);
                    }
                    break Fd;
                case 0x09://OR	r/m16/32	r16/32  Logical Inclusive OR
                case 0x11://ADC	r/m16/32	r16/32	Add with Carry
                case 0x19://SBB	r/m16/32	r16/32  Integer Subtraction with Borrow
                case 0x21://AND	r/m16/32	r16/32	Logical AND
                case 0x29://SUB	r/m16/32	r16/32  Subtract
                case 0x31://XOR	r/m16/32	r16/32  Logical Exclusive OR
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    Ha = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = do_32bit_math(Ja, regs[register_0], Ha);
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_write();
                        x = do_32bit_math(Ja, x, Ha);
                        wb(x);
                    }
                    break Fd;
                case 0x39://CMP	r/m16/32	r16/32  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    Ha = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        {
                            _src = Ha;
                            _dst = (regs[register_0] - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_read();
                        {
                            _src = Ha;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    }
                    break Fd;
                case 0x02://ADD	r8	r/m8  Add
                case 0x0a://OR	r8	r/m8  Logical Inclusive OR
                case 0x12://ADC	r8	r/m8  Add with Carry
                case 0x1a://SBB	r8	r/m8  Integer Subtraction with Borrow
                case 0x22://AND	r8	r/m8  Logical AND
                case 0x2a://SUB	r8	r/m8  Subtract
                case 0x32://XOR	r8	r/m8  Logical Exclusive OR
                case 0x3a://CMP	r8	r/m8  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        Ha = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_8bits_mem8_read();
                    }
                    set_either_two_bytes_of_reg_ABCD(register_1, do_8bit_math(Ja, (regs[register_1 & 3] >> ((register_1 & 4) << 1)), Ha));
                    break Fd;
                case 0x03:
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_32bits_mem8_read();
                    }
                    {
                        _src = Ha;
                        _dst = regs[register_1] = (regs[register_1] + _src) >> 0;
                        _op = 2;
                    }
                    break Fd;
                case 0x0b:
                case 0x13:
                case 0x1b:
                case 0x23:
                case 0x2b:
                case 0x33:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_32bits_mem8_read();
                    }
                    regs[register_1] = do_32bit_math(Ja, regs[register_1], Ha);
                    break Fd;
                case 0x3b:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_32bits_mem8_read();
                    }
                    {
                        _src = Ha;
                        _dst = (regs[register_1] - _src) >> 0;
                        _op = 8;
                    }
                    break Fd;
                case 0x04:
                case 0x0c:
                case 0x14:
                case 0x1c:
                case 0x24:
                case 0x2c:
                case 0x34:
                case 0x3c:
                    Ha = phys_mem8[mem_ptr++];
                    Ja = OPbyte >> 3;
                    set_either_two_bytes_of_reg_ABCD(0, do_8bit_math(Ja, regs[0] & 0xff, Ha));
                    break Fd;
                case 0x05:
                    {
                        Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _src = Ha;
                        _dst = regs[0] = (regs[0] + _src) >> 0;
                        _op = 2;
                    }
                    break Fd;
                case 0x0d:
                case 0x15:
                case 0x1d:
                case 0x25:
                case 0x2d:
                    {
                        Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    Ja = OPbyte >> 3;
                    regs[0] = do_32bit_math(Ja, regs[0], Ha);
                    break Fd;
                case 0x35:
                    {
                        Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _dst = regs[0] = regs[0] ^ Ha;
                        _op = 14;
                    }
                    break Fd;
                case 0x3d:
                    {
                        Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _src = Ha;
                        _dst = (regs[0] - _src) >> 0;
                        _op = 8;
                    }
                    break Fd;
                case 0x80:
                case 0x82:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        Ha = phys_mem8[mem_ptr++];
                        set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(Ja, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), Ha));
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = phys_mem8[mem_ptr++];
                        if (Ja != 7) {
                            x = ld_8bits_mem8_write();
                            x = do_8bit_math(Ja, x, Ha);
                            sb(x);
                        } else {
                            x = ld_8bits_mem8_read();
                            do_8bit_math(7, x, Ha);
                        }
                    }
                    break Fd;
                case 0x81:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if (Ja == 7) {
                        if ((mem8 >> 6) == 3) {
                            x = regs[mem8 & 7];
                        } else {
                            mem8_loc = Pb(mem8);
                            x = ld_32bits_mem8_read();
                        }
                        {
                            Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        {
                            _src = Ha;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        if ((mem8 >> 6) == 3) {
                            register_0 = mem8 & 7;
                            {
                                Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            regs[register_0] = do_32bit_math(Ja, regs[register_0], Ha);
                        } else {
                            mem8_loc = Pb(mem8);
                            {
                                Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            x = ld_32bits_mem8_write();
                            x = do_32bit_math(Ja, x, Ha);
                            wb(x);
                        }
                    }
                    break Fd;
                case 0x83:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if (Ja == 7) {
                        if ((mem8 >> 6) == 3) {
                            x = regs[mem8 & 7];
                        } else {
                            mem8_loc = Pb(mem8);
                            x = ld_32bits_mem8_read();
                        }
                        Ha = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        {
                            _src = Ha;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        if ((mem8 >> 6) == 3) {
                            register_0 = mem8 & 7;
                            Ha = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            regs[register_0] = do_32bit_math(Ja, regs[register_0], Ha);
                        } else {
                            mem8_loc = Pb(mem8);
                            Ha = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            x = ld_32bits_mem8_write();
                            x = do_32bit_math(Ja, x, Ha);
                            wb(x);
                        }
                    }
                    break Fd;
                case 0x40:
                case 0x41:
                case 0x42:
                case 0x43:
                case 0x44:
                case 0x45:
                case 0x46:
                case 0x47:
                    register_1 = OPbyte & 7;
                    {
                        if (_op < 25) {
                            _op2 = _op;
                            _dst2 = _dst;
                        }
                        regs[register_1] = _dst = (regs[register_1] + 1) >> 0;
                        _op = 27;
                    }
                    break Fd;
                case 0x48:
                case 0x49:
                case 0x4a:
                case 0x4b:
                case 0x4c:
                case 0x4d:
                case 0x4e:
                case 0x4f:
                    register_1 = OPbyte & 7;
                    {
                        if (_op < 25) {
                            _op2 = _op;
                            _dst2 = _dst;
                        }
                        regs[register_1] = _dst = (regs[register_1] - 1) >> 0;
                        _op = 30;
                    }
                    break Fd;
                case 0x6b:
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_32bits_mem8_read();
                    }
                    Ia = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    regs[register_1] = Wc(Ha, Ia);
                    break Fd;
                case 0x69:
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = ld_32bits_mem8_read();
                    }
                    {
                        Ia = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    regs[register_1] = Wc(Ha, Ia);
                    break Fd;
                case 0x84:
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_8bits_mem8_read();
                    }
                    register_1 = (mem8 >> 3) & 7;
                    Ha = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    {
                        _dst = (((x & Ha) << 24) >> 24);
                        _op = 12;
                    }
                    break Fd;
                case 0x85:
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7];
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_read();
                    }
                    Ha = regs[(mem8 >> 3) & 7];
                    {
                        _dst = x & Ha;
                        _op = 14;
                    }
                    break Fd;
                case 0xa8:
                    Ha = phys_mem8[mem_ptr++];
                    {
                        _dst = (((regs[0] & Ha) << 24) >> 24);
                        _op = 12;
                    }
                    break Fd;
                case 0xa9:
                    {
                        Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _dst = regs[0] & Ha;
                        _op = 14;
                    }
                    break Fd;
                case 0xf6:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            Ha = phys_mem8[mem_ptr++];
                            {
                                _dst = (((x & Ha) << 24) >> 24);
                                _op = 12;
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, ~(regs[register_0 & 3] >> ((register_0 & 4) << 1)));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                x = ~x;
                                sb(x);
                            }
                            break;
                        case 3:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(5, 0, (regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                x = do_8bit_math(5, 0, x);
                                sb(x);
                            }
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(0, Oc(regs[0], x));
                            break;
                        case 5:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(0, Pc(regs[0], x));
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            Cc(x);
                            break;
                        case 7:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            Ec(x);
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xf7:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            {
                                Ha = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            {
                                _dst = x & Ha;
                                _op = 14;
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = ~regs[register_0];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                x = ~x;
                                wb(x);
                            }
                            break;
                        case 3:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = do_32bit_math(5, 0, regs[register_0]);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                x = do_32bit_math(5, 0, x);
                                wb(x);
                            }
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Vc(regs[0], x);
                            regs[2] = Ma;
                            break;
                        case 5:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Wc(regs[0], x);
                            regs[2] = Ma;
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Hc(regs[2], regs[0], x);
                            regs[2] = Ma;
                            break;
                        case 7:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Lc(regs[2], regs[0], x);
                            regs[2] = Ma;
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                //Rotate and Shift ops
                /*
                  C0        0   01+                 ROL r/m8    imm8                    o..szapc    o..szapc    o.......        Rotate
                  C0        1   01+                 ROR r/m8    imm8                    o..szapc    o..szapc    o.......        Rotate
                  C0        2   01+                 RCL r/m8    imm8                .......c    o..szapc    o..szapc    o.......        Rotate
                  C0        3   01+                 RCR r/m8    imm8                .......c    o..szapc    o..szapc    o.......        Rotate
                  C0        4   01+                 SHL r/m8    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  SAL   r/m8    imm8
                  C0        5   01+                 SHR r/m8    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  C0        6   01+ U2              SAL r/m8    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  SHL   r/m8    imm8
                  C0        7   01+                 SAR r/m8    imm8                    o..szapc    o..sz.pc    o....a..        Shift
                */
                case 0xc0:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = phys_mem8[mem_ptr++];
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(Ja, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), Ha));
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = phys_mem8[mem_ptr++];
                        x = ld_8bits_mem8_write();
                        x = shift8(Ja, x, Ha);
                        sb(x);
                    }
                    break Fd;
                /*
                  C1        0   01+                 ROL r/m16/32    imm8                    o..szapc    o..szapc    o.......        Rotate
                  C1        1   01+                 ROR r/m16/32    imm8                    o..szapc    o..szapc    o.......        Rotate
                  C1        2   01+                 RCL r/m16/32    imm8                .......c    o..szapc    o..szapc    o.......        Rotate
                  C1        3   01+                 RCR r/m16/32    imm8                .......c    o..szapc    o..szapc    o.......        Rotate
                  C1        4   01+                 SHL r/m16/32    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  SAL   r/m16/32    imm8
                  C1        5   01+                 SHR r/m16/32    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  C1        6   01+ U2              SAL r/m16/32    imm8                    o..szapc    o..sz.pc    o....a.c        Shift
                  SHL   r/m16/32    imm8
                  C1        7   01+                 SAR r/m16/32    imm8                    o..szapc    o..sz.pc    o....a..        Shift
                */
                case 0xc1:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        Ha = phys_mem8[mem_ptr++];
                        register_0 = mem8 & 7;
                        regs[register_0] = nc(Ja, regs[register_0], Ha);
                    } else {
                        mem8_loc = Pb(mem8);
                        Ha = phys_mem8[mem_ptr++];
                        x = ld_32bits_mem8_write();
                        x = nc(Ja, x, Ha);
                        wb(x);
                    }
                    break Fd;
                /*
                  D0        0                       ROL r/m8    1                   o..szapc    o..szapc            Rotate
                  D0        1                       ROR r/m8    1                   o..szapc    o..szapc            Rotate
                  D0        2                       RCL r/m8    1               .......c    o..szapc    o..szapc            Rotate
                  D0        3                       RCR r/m8    1               .......c    o..szapc    o..szapc            Rotate
                  D0        4                       SHL r/m8    1                   o..szapc    o..sz.pc    .....a..        Shift
                  SAL   r/m8    1
                  D0        5                       SHR r/m8    1                   o..szapc    o..sz.pc    .....a..        Shift
                  D0        6       U2              SAL r/m8    1                   o..szapc    o..sz.pc    .....a..        Shift
                  SHL   r/m8    1
                  D0        7                       SAR r/m8    1                   o..szapc    o..sz.pc    .....a..        Shift
                */
                case 0xd0:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(Ja, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), 1));
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_8bits_mem8_write();
                        x = shift8(Ja, x, 1);
                        sb(x);
                    }
                    break Fd;
                /*
                  D1        0                       ROL r/m16/32    1                   o..szapc    o..szapc            Rotate
                  D1        1                       ROR r/m16/32    1                   o..szapc    o..szapc            Rotate
                  D1        2                       RCL r/m16/32    1               .......c    o..szapc    o..szapc            Rotate
                  D1        3                       RCR r/m16/32    1               .......c    o..szapc    o..szapc            Rotate
                  D1        4                       SHL r/m16/32    1                   o..szapc    o..sz.pc    .....a..        Shift
                  SAL   r/m16/32    1
                  D1        5                       SHR r/m16/32    1                   o..szapc    o..sz.pc    .....a..        Shift
                  D1        6       U2              SAL r/m16/32    1                   o..szapc    o..sz.pc    .....a..        Shift
                  SHL   r/m16/32    1
                  D1        7                       SAR r/m16/32    1                   o..szapc    o..sz.pc    .....a..        Shift
                */
                case 0xd1:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = nc(Ja, regs[register_0], 1);
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_write();
                        x = nc(Ja, x, 1);
                        wb(x);
                    }
                    break Fd;
                /*
                  D2        0                       ROL r/m8    CL                  o..szapc    o..szapc    o.......        Rotate
                  D2        1                       ROR r/m8    CL                  o..szapc    o..szapc    o.......        Rotate
                  D2        2                       RCL r/m8    CL              .......c    o..szapc    o..szapc    o.......        Rotate
                  D2        3                       RCR r/m8    CL              .......c    o..szapc    o..szapc    o.......        Rotate
                  D2        4                       SHL r/m8    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  SAL   r/m8    CL
                  D2        5                       SHR r/m8    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  D2        6       U2              SAL r/m8    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  SHL   r/m8    CL
                  D2        7                       SAR r/m8    CL                  o..szapc    o..sz.pc    o....a..        Shift
                */
                case 0xd2:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    Ha = regs[1] & 0xff;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(Ja, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), Ha));
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_8bits_mem8_write();
                        x = shift8(Ja, x, Ha);
                        sb(x);
                    }
                    break Fd;
                /*
                  D3        0                       ROL r/m16/32    CL                  o..szapc    o..szapc    o.......        Rotate
                  D3        1                       ROR r/m16/32    CL                  o..szapc    o..szapc    o.......        Rotate
                  D3        2                       RCL r/m16/32    CL              .......c    o..szapc    o..szapc    o.......        Rotate
                  D3        3                       RCR r/m16/32    CL              .......c    o..szapc    o..szapc    o.......        Rotate
                  D3        4                       SHL r/m16/32    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  SAL   r/m16/32    CL
                  D3        5                       SHR r/m16/32    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  D3        6       U2              SAL r/m16/32    CL                  o..szapc    o..sz.pc    o....a.c        Shift
                  SHL   r/m16/32    CL
                  D3        7                       SAR r/m16/32    CL                  o..szapc    o..sz.pc    .....a..        Shift
                */
                case 0xd3:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    Ha = regs[1] & 0xff;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = nc(Ja, regs[register_0], Ha);
                    } else {
                        mem8_loc = Pb(mem8);
                        x = ld_32bits_mem8_write();
                        x = nc(Ja, x, Ha);
                        wb(x);
                    }
                    break Fd;
                //98                                CBW AX  AL                                  Convert Byte to Word
                case 0x98:
                    regs[0] = (regs[0] << 16) >> 16;
                    break Fd;
                //99                                CWD DX  AX                                  Convert Word to Doubleword
                case 0x99:
                    regs[2] = regs[0] >> 31;
                    break Fd;
                //50+r                          PUSH    r16/32                                      Push Word, Doubleword or Quadword Onto the Stack
                case 0x50:
                case 0x51:
                case 0x52:
                case 0x53:
                case 0x54:
                case 0x55:
                case 0x56:
                case 0x57:
                    x = regs[OPbyte & 7];
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        {
                            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
                            if ((last_tlb_val | mem8_loc) & 3) {
                                vb(x);
                            } else {
                                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
                            }
                        }
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                //58+r                          POP r16/32                                      Pop a Value from the Stack
                case 0x58:
                case 0x59:
                case 0x5a:
                case 0x5b:
                case 0x5c:
                case 0x5d:
                case 0x5e:
                case 0x5f:
                    if (FS_usage_flag) {
                        mem8_loc = regs[4];
                        x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_read() : phys_mem32[(mem8_loc ^ last_tlb_val) >> 2]);
                        regs[4] = (mem8_loc + 4) >> 0;
                    } else {
                        x = Ad();
                        Bd();
                    }
                    regs[OPbyte & 7] = x;
                    break Fd;
                //60            01+                 PUSHA   AX  CX  DX  ...                         Push All General-Purpose Registers
                case 0x60:
                    Kf();
                    break Fd;
               //61         01+                 POPA    DI  SI  BP  ...                         Pop All General-Purpose Registers
                case 0x61:
                    Mf();
                    break Fd;
                //8F        0                       POP r/m16/32                                        Pop a Value from the Stack
                case 0x8f:
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = Ad();
                        Bd();
                        regs[mem8 & 7] = x;
                    } else {
                        x = Ad();
                        Ha = regs[4];
                        Bd();
                        Ia = regs[4];
                        mem8_loc = Pb(mem8);
                        regs[4] = Ha;
                        wb(x);
                        regs[4] = Ia;
                    }
                    break Fd;
                //68            01+                 PUSH    imm16/32                                        Push Word, Doubleword or Quadword Onto the Stack
                case 0x68:
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        wb(x);
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                //6A            01+                 PUSH    imm8                                        Push Word, Doubleword or Quadword Onto the Stack
                case 0x6a:
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        wb(x);
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                //C8            01+                 ENTER   eBP imm16   imm8                                Make Stack Frame for Procedure Parameters
                case 0xc8:
                    Tf();
                    break Fd;
                //C9            01+                 LEAVE   eBP                                     High Level Procedure Exit
                case 0xc9:
                    if (FS_usage_flag) {
                        mem8_loc = regs[5];
                        x = ld_32bits_mem8_read();
                        regs[5] = x;
                        regs[4] = (mem8_loc + 4) >> 0;
                    } else {
                        Of();
                    }
                    break Fd;
                /*
                  9C                                PUSHF   Flags                                       Push FLAGS Register onto the Stack
                  9C            03+                 PUSHFD  EFlags                                      Push eFLAGS Register onto the Stack
                */
                case 0x9c:
                    Sa = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && Sa != 3)
                        blow_up_errcode0(13);
                    x = id() & ~(0x00020000 | 0x00010000);
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        xd(x);
                    } else {
                        vd(x);
                    }
                    break Fd;
                /*
                  9D                                POPF    Flags                                       Pop Stack into FLAGS Register
                  9D            03+                 POPFD   EFlags                                      Pop Stack into eFLAGS Register
                */
                case 0x9d:
                    Sa = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && Sa != 3)
                        blow_up_errcode0(13);
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        x = Ad();
                        Bd();
                        Ha = -1;
                    } else {
                        x = yd();
                        zd();
                        Ha = 0xffff;
                    }
                    Ia = (0x00000100 | 0x00040000 | 0x00200000 | 0x00004000);
                    if (cpu.cpl == 0) {
                        Ia |= 0x00000200 | 0x00003000;
                    } else {
                        if (cpu.cpl <= Sa)
                            Ia |= 0x00000200;
                    }
                    kd(x, Ia & Ha);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x06:
                case 0x0e:
                case 0x16:
                case 0x1e:
                    xd(cpu.segs[OPbyte >> 3].selector);
                    break Fd;
                case 0x07:
                case 0x17:
                case 0x1f:
                    Ie(OPbyte >> 3, Ad() & 0xffff);
                    Bd();
                    break Fd;
                case 0x8d:
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3)
                        blow_up_errcode0(6);
                    CS_flags = (CS_flags & ~0x000f) | (6 + 1);
                    regs[(mem8 >> 3) & 7] = Pb(mem8);
                    break Fd;
                case 0xfe:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, hc((regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                x = hc(x);
                                sb(x);
                            }
                            break;
                        case 1:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, ic((regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                x = ic(x);
                                sb(x);
                            }
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xff:
                    mem8 = phys_mem8[mem_ptr++];
                    Ja = (mem8 >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    regs[register_0] = _dst = (regs[register_0] + 1) >> 0;
                                    _op = 27;
                                }
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    x = _dst = (x + 1) >> 0;
                                    _op = 27;
                                }
                                wb(x);
                            }
                            break;
                        case 1:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    regs[register_0] = _dst = (regs[register_0] - 1) >> 0;
                                    _op = 30;
                                }
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    x = _dst = (x - 1) >> 0;
                                    _op = 30;
                                }
                                wb(x);
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            Ha = (eip + mem_ptr - initial_mem_ptr);
                            if (FS_usage_flag) {
                                mem8_loc = (regs[4] - 4) >> 0;
                                wb(Ha);
                                regs[4] = mem8_loc;
                            } else {
                                xd(Ha);
                            }
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            if (FS_usage_flag) {
                                mem8_loc = (regs[4] - 4) >> 0;
                                wb(x);
                                regs[4] = mem8_loc;
                            } else {
                                xd(x);
                            }
                            break;
                        case 3:
                        case 5:
                            if ((mem8 >> 6) == 3)
                                blow_up_errcode0(6);
                            mem8_loc = Pb(mem8);
                            x = ld_32bits_mem8_read();
                            mem8_loc = (mem8_loc + 4) >> 0;
                            Ha = ld_16bits_mem8_read();
                            if (Ja == 3)
                                Ze(1, Ha, x, (eip + mem_ptr - initial_mem_ptr));
                            else
                                Oe(Ha, x);
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xeb:
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0xe9:
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0xea:
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                    } else {
                        x = Ob();
                    }
                    Ha = Ob();
                    Oe(Ha, x);
                    break Fd;
                case 0x70:
                    if (check_overflow()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x71:
                    if (!check_overflow()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x72:
                    if (check_carry()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x73:
                    if (!check_carry()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x74:
                    if ((_dst == 0)) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x75:
                    if (!(_dst == 0)) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x76:
                    if (ad()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x77:
                    if (!ad()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x78:
                    if ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x79:
                    if (!(_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7a:
                    if (check_parity()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7b:
                    if (!check_parity()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7c:
                    if (cd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7d:
                    if (!cd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7e:
                    if (dd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7f:
                    if (!dd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0xe0:
                case 0xe1:
                case 0xe2:
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (CS_flags & 0x0080)
                        Ja = 0xffff;
                    else
                        Ja = -1;
                    Ha = (regs[1] - 1) & Ja;
                    regs[1] = (regs[1] & ~Ja) | Ha;
                    OPbyte &= 3;
                    if (OPbyte == 0)
                        Ia = !(_dst == 0);
                    else if (OPbyte == 1)
                        Ia = (_dst == 0);
                    else
                        Ia = 1;
                    if (Ha && Ia) {
                        if (CS_flags & 0x0100) {
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                        } else {
                            mem_ptr = (mem_ptr + x) >> 0;
                        }
                    }
                    break Fd;
                case 0xe3:
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (CS_flags & 0x0080)
                        Ja = 0xffff;
                    else
                        Ja = -1;
                    if ((regs[1] & Ja) == 0) {
                        if (CS_flags & 0x0100) {
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                        } else {
                            mem_ptr = (mem_ptr + x) >> 0;
                        }
                    }
                    break Fd;
                case 0xc2:
                    Ha = (Ob() << 16) >> 16;
                    x = Ad();
                    regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 4 + Ha) & SS_mask);
                    eip = x, mem_ptr = initial_mem_ptr = 0;
                    break Fd;
                case 0xc3:
                    if (FS_usage_flag) {
                        mem8_loc = regs[4];
                        x = ld_32bits_mem8_read();
                        regs[4] = (regs[4] + 4) >> 0;
                    } else {
                        x = Ad();
                        Bd();
                    }
                    eip = x, mem_ptr = initial_mem_ptr = 0;
                    break Fd;
                case 0xe8:
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    Ha = (eip + mem_ptr - initial_mem_ptr);
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        wb(Ha);
                        regs[4] = mem8_loc;
                    } else {
                        xd(Ha);
                    }
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0x9a:
                    Ia = (((CS_flags >> 8) & 1) ^ 1);
                    if (Ia) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                    } else {
                        x = Ob();
                    }
                    Ha = Ob();
                    Ze(Ia, Ha, x, (eip + mem_ptr - initial_mem_ptr));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xca:
                    Ha = (Ob() << 16) >> 16;
                    nf((((CS_flags >> 8) & 1) ^ 1), Ha);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xcb:
                    nf((((CS_flags >> 8) & 1) ^ 1), 0);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xcf:
                    mf((((CS_flags >> 8) & 1) ^ 1));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x90:
                    break Fd;
                case 0xcc:
                    Ha = (eip + mem_ptr - initial_mem_ptr);
                    Ae(3, 1, 0, Ha, 0);
                    break Fd;
                case 0xcd:
                    x = phys_mem8[mem_ptr++];
                    if ((cpu.eflags & 0x00020000) && ((cpu.eflags >> 12) & 3) != 3)
                        blow_up_errcode0(13);
                    Ha = (eip + mem_ptr - initial_mem_ptr);
                    Ae(x, 1, 0, Ha, 0);
                    break Fd;
                case 0xce:
                    if (check_overflow()) {
                        Ha = (eip + mem_ptr - initial_mem_ptr);
                        Ae(4, 1, 0, Ha, 0);
                    }
                    break Fd;
                //62        r   01+         f       BOUND   r16/32  m16/32&16/32    eFlags              ..i.....    ..i.....        ..i.....    Check Array Index Against Bounds
                case 0x62:
                    Hf();
                    break Fd;
                //  F5                              CMC                     .......c    .......c    .......c            Complement Carry Flag
                case 0xf5:
                    _src = hd() ^ 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                //F8                                CLC                         .......c    .......c        .......c    Clear Carry Flag
                case 0xf8:
                    _src = hd() & ~0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                //F9                                STC                         .......c    .......c        .......C    Set Carry Flag
                case 0xf9:
                    _src = hd() | 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                //FC                                CLD                         .d......    .d......        .d......    Clear Direction Flag
                case 0xfc:
                    cpu.df = 1;
                    break Fd;
                //FD                                STD                         .d......    .d......        .D......    Set Direction Flag
                case 0xfd:
                    cpu.df = -1;
                    break Fd;
                case 0xfa:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    cpu.eflags &= ~0x00000200;
                    break Fd;
                case 0xfb:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    cpu.eflags |= 0x00000200;
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x9e:
                    _src = ((regs[0] >> 8) & (0x0080 | 0x0040 | 0x0010 | 0x0004 | 0x0001)) | (check_overflow() << 11);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0x9f:
                    x = id();
                    set_either_two_bytes_of_reg_ABCD(4, x);
                    break Fd;
                case 0xf4:
                    if (cpu.cpl != 0)
                        blow_up_errcode0(13);
                    cpu.halted = 1;
                    La = 257;
                    break Bg;
                //A4                                MOVS    m8  m8              .d......                    Move Data from String to String
                //MOVSB m8  m8
                case 0xa4:
                    dg();
                    break Fd;
                //A5                                MOVS    m16 m16             .d......                    Move Data from String to String
                //MOVSW m16 m16
                case 0xa5:
                    sg();
                    break Fd;
                //AA                                STOS    m8  AL              .d......                    Store String
                //STOSB m8  AL
                case 0xaa:
                    fg();
                    break Fd;
                case 0xab:
                    xg();
                    break Fd;
                case 0xa6:
                    gg();
                    break Fd;
                case 0xa7:
                    yg();
                    break Fd;
                case 0xac:
                    hg();
                    break Fd;
                case 0xad:
                    zg();
                    break Fd;
                case 0xae:
                    ig();
                    break Fd;
                case 0xaf:
                    Ag();
                    break Fd;
                case 0x6c:
                    Wf();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6d:
                    qg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6e:
                    bg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6f:
                    rg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xd8:
                case 0xd9:
                case 0xda:
                case 0xdb:
                case 0xdc:
                case 0xdd:
                case 0xde:
                case 0xdf:
                    if (cpu.cr0 & ((1 << 2) | (1 << 3))) {
                        blow_up_errcode0(7);
                    }
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    register_0 = mem8 & 7;
                    Ja = ((OPbyte & 7) << 3) | ((mem8 >> 3) & 7);
                    set_lower_two_bytes_of_register(0, 0xffff);
                    if ((mem8 >> 6) == 3) {
                    } else {
                        mem8_loc = Pb(mem8);
                    }
                    break Fd;
                case 0x9b:
                    break Fd;
                case 0xe4:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    set_either_two_bytes_of_reg_ABCD(0, cpu.ld8_port(x));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe5:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    regs[0] = cpu.ld32_port(x);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe6:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    cpu.st8_port(x, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe7:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    cpu.st32_port(x, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xec:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    set_either_two_bytes_of_reg_ABCD(0, cpu.ld8_port(regs[2] & 0xffff));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xed:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    regs[0] = cpu.ld32_port(regs[2] & 0xffff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xee:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    cpu.st8_port(regs[2] & 0xffff, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xef:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        blow_up_errcode0(13);
                    cpu.st32_port(regs[2] & 0xffff, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x27:
                    Df();
                    break Fd;
                case 0x2f:
                    Ff();
                    break Fd;
                case 0x37:
                    zf();
                    break Fd;
                case 0x3f:
                    Cf();
                    break Fd;
                case 0xd4:
                    x = phys_mem8[mem_ptr++];
                    vf(x);
                    break Fd;
                case 0xd5:
                    x = phys_mem8[mem_ptr++];
                    yf(x);
                    break Fd;
                case 0x63:
                    tf();
                    break Fd;
                case 0xd6:
                case 0xf1:
                    blow_up_errcode0(6);
                    break;

                /*
                   TWO BYTE CODE INSTRUCTIONS BEGIN WITH 0F :  0F xx
                   =====================================================================================================
                */
                case 0x0f:
                    OPbyte = phys_mem8[mem_ptr++];
                    switch (OPbyte) {
                        /*
                          0F  80          03+                 JO  rel16/32                    o.......                    Jump short if overflow (OF=1)
                          0F  81          03+                 JNO rel16/32                    o.......                    Jump short if not overflow (OF=0)
                          0F  82          03+                 JB  rel16/32                    .......c                    Jump short if below/not above or equal/carry (CF=1)
                                                              JNAE    rel16/32
                                                              JC  rel16/32
                          0F  83          03+                 JNB rel16/32                    .......c                    Jump short if not below/above or equal/not carry (CF=0)
                                                              JAE rel16/32
                                                              JNC rel16/32
                          0F  84          03+                 JZ  rel16/32                    ....z...                    Jump short if zero/equal (ZF=0)
                                                              JE  rel16/32
                          0F  85          03+                 JNZ rel16/32                    ....z...                    Jump short if not zero/not equal (ZF=1)
                                                              JNE rel16/32
                          0F  86          03+                 JBE rel16/32                    ....z..c                    Jump short if below or equal/not above (CF=1 AND ZF=1)
                                                              JNA rel16/32
                          0F  87          03+                 JNBE    rel16/32                    ....z..c                    Jump short if not below or equal/above (CF=0 AND ZF=0)
                                                              JA  rel16/32
                          0F  88          03+                 JS  rel16/32                    ...s....                    Jump short if sign (SF=1)
                          0F  89          03+                 JNS rel16/32                    ...s....                    Jump short if not sign (SF=0)
                          0F  8A          03+                 JP  rel16/32                    ......p.                    Jump short if parity/parity even (PF=1)
                                                              JPE rel16/32
                          0F  8B          03+                 JNP rel16/32                    ......p.                    Jump short if not parity/parity odd
                                                              JPO rel16/32
                          0F  8C          03+                 JL  rel16/32                    o..s....                    Jump short if less/not greater (SF!=OF)
                                                              JNGE    rel16/32
                          0F  8D          03+                 JNL rel16/32                    o..s....                    Jump short if not less/greater or equal (SF=OF)
                                                              JGE rel16/32
                          0F  8E          03+                 JLE rel16/32                    o..sz...                    Jump short if less or equal/not greater ((ZF=1) OR (SF!=OF))
                                                              JNG rel16/32
                          0F  8F          03+                 JNLE    rel16/32                    o..sz...                    Jump short if not less nor equal/greater ((ZF=0) AND (SF=OF))
                        */
                        case 0x80:
                        case 0x81:
                        case 0x82:
                        case 0x83:
                        case 0x84:
                        case 0x85:
                        case 0x86:
                        case 0x87:
                        case 0x88:
                        case 0x89:
                        case 0x8a:
                        case 0x8b:
                        case 0x8c:
                        case 0x8d:
                        case 0x8e:
                        case 0x8f:
                            {
                                x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            if (check_status_bits_for_jump(OPbyte & 0xf))
                                mem_ptr = (mem_ptr + x) >> 0;
                            break Fd;
                        case 0x90:
                        case 0x91:
                        case 0x92:
                        case 0x93:
                        case 0x94:
                        case 0x95:
                        case 0x96:
                        case 0x97:
                        case 0x98:
                        case 0x99:
                        case 0x9a:
                        case 0x9b:
                        case 0x9c:
                        case 0x9d:
                        case 0x9e:
                        case 0x9f:
                            mem8 = phys_mem8[mem_ptr++];
                            x = check_status_bits_for_jump(OPbyte & 0xf);
                            if ((mem8 >> 6) == 3) {
                                set_either_two_bytes_of_reg_ABCD(mem8 & 7, x);
                            } else {
                                mem8_loc = Pb(mem8);
                                sb(x);
                            }
                            break Fd;
                        case 0x40:
                        case 0x41:
                        case 0x42:
                        case 0x43:
                        case 0x44:
                        case 0x45:
                        case 0x46:
                        case 0x47:
                        case 0x48:
                        case 0x49:
                        case 0x4a:
                        case 0x4b:
                        case 0x4c:
                        case 0x4d:
                        case 0x4e:
                        case 0x4f:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            if (check_status_bits_for_jump(OPbyte & 0xf))
                                regs[(mem8 >> 3) & 7] = x;
                            break Fd;
                        case 0xb6:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1)) & 0xff;
                            } else {
                                mem8_loc = Pb(mem8);
                                x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                            }
                            regs[register_1] = x;
                            break Fd;
                        case 0xb7:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7] & 0xffff;
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            regs[register_1] = x;
                            break Fd;
                        case 0xbe:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                            }
                            regs[register_1] = (((x) << 24) >> 24);
                            break Fd;
                        case 0xbf:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            regs[register_1] = (((x) << 16) >> 16);
                            break Fd;
                        case 0x00:
                            if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
                                blow_up_errcode0(6);
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                case 1:
                                    if (Ja == 0)
                                        x = cpu.ldt.selector;
                                    else
                                        x = cpu.tr.selector;
                                    if ((mem8 >> 6) == 3) {
                                        set_lower_two_bytes_of_register(mem8 & 7, x);
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        ub(x);
                                    }
                                    break;
                                case 2:
                                case 3:
                                    if (cpu.cpl != 0)
                                        blow_up_errcode0(13);
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    if (Ja == 2)
                                        Ce(x);
                                    else
                                        Ee(x);
                                    break;
                                case 4:
                                case 5:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    sf(x, Ja & 1);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x01:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            switch (Ja) {
                                case 2:
                                case 3:
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    if (this.cpl != 0)
                                        blow_up_errcode0(13);
                                    mem8_loc = Pb(mem8);
                                    x = ld_16bits_mem8_read();
                                    mem8_loc += 2;
                                    Ha = ld_32bits_mem8_read();
                                    if (Ja == 2) {
                                        this.gdt.base = Ha;
                                        this.gdt.limit = x;
                                    } else {
                                        this.idt.base = Ha;
                                        this.idt.limit = x;
                                    }
                                    break;
                                case 7:
                                    if (this.cpl != 0)
                                        blow_up_errcode0(13);
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    mem8_loc = Pb(mem8);
                                    cpu.tlb_flush_page(mem8_loc & -4096);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x02:
                        case 0x03:
                            qf((((CS_flags >> 8) & 1) ^ 1), OPbyte & 1);
                            break Fd;
                        case 0x20:
                            if (cpu.cpl != 0)
                                blow_up_errcode0(13);
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) != 3)
                                blow_up_errcode0(6);
                            register_1 = (mem8 >> 3) & 7;
                            switch (register_1) {
                                case 0:
                                    x = cpu.cr0;
                                    break;
                                case 2:
                                    x = cpu.cr2;
                                    break;
                                case 3:
                                    x = cpu.cr3;
                                    break;
                                case 4:
                                    x = cpu.cr4;
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            regs[mem8 & 7] = x;
                            break Fd;
                        //  0F  22      r   03+         0       MOV CRn r32                 o..szapc        o..szapc        Move to/from Control Registers
                        case 0x22:
                            if (cpu.cpl != 0)
                                blow_up_errcode0(13);
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) != 3)
                                blow_up_errcode0(6);
                            register_1 = (mem8 >> 3) & 7;
                            x = regs[mem8 & 7];
                            switch (register_1) {
                                case 0:
                                    set_CR0(x);
                                    break;
                                case 2:
                                    cpu.cr2 = x;
                                    break;
                                case 3:
                                    set_CR3(x);
                                    break;
                                case 4:
                                    set_CR4(x);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        // 0F   06          02+         0       CLTS    CR0                                     Clear Task-Switched Flag in CR0
                        case 0x06:
                            if (cpu.cpl != 0)
                                blow_up_errcode0(13);
                            set_CR0(cpu.cr0 & ~(1 << 3)); //Clear Task-Switched Flag in CR0
                            break Fd;
                        case 0x23:
                            if (cpu.cpl != 0)
                                blow_up_errcode0(13);
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) != 3)
                                blow_up_errcode0(6);
                            register_1 = (mem8 >> 3) & 7;
                            x = regs[mem8 & 7];
                            if (register_1 == 4 || register_1 == 5)
                                blow_up_errcode0(6);
                            break Fd;
                        case 0xb2:
                        case 0xb4:
                        case 0xb5:
                            Uf(OPbyte & 7);
                            break Fd;
                        case 0xa2:
                            uf();
                            break Fd;
                        case 0xa4:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                Ia = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                regs[register_0] = rc(regs[register_0], Ha, Ia);
                            } else {
                                mem8_loc = Pb(mem8);
                                Ia = phys_mem8[mem_ptr++];
                                x = ld_32bits_mem8_write();
                                x = rc(x, Ha, Ia);
                                wb(x);
                            }
                            break Fd;
                        case 0xa5:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            Ia = regs[1];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = rc(regs[register_0], Ha, Ia);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                x = rc(x, Ha, Ia);
                                wb(x);
                            }
                            break Fd;
                        case 0xac:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                Ia = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                regs[register_0] = sc(regs[register_0], Ha, Ia);
                            } else {
                                mem8_loc = Pb(mem8);
                                Ia = phys_mem8[mem_ptr++];
                                x = ld_32bits_mem8_write();
                                x = sc(x, Ha, Ia);
                                wb(x);
                            }
                            break Fd;
                        case 0xad:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            Ia = regs[1];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = sc(regs[register_0], Ha, Ia);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                x = sc(x, Ha, Ia);
                                wb(x);
                            }
                            break Fd;
                        case 0xba:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            switch (Ja) {
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                        Ha = phys_mem8[mem_ptr++];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        Ha = phys_mem8[mem_ptr++];
                                        x = ld_32bits_mem8_read();
                                    }
                                    uc(x, Ha);
                                    break;
                                case 5:
                                case 6:
                                case 7:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        Ha = phys_mem8[mem_ptr++];
                                        regs[register_0] = xc(Ja & 3, regs[register_0], Ha);
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        Ha = phys_mem8[mem_ptr++];
                                        x = ld_32bits_mem8_write();
                                        x = xc(Ja & 3, x, Ha);
                                        wb(x);
                                    }
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0xa3:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                mem8_loc = (mem8_loc + ((Ha >> 5) << 2)) >> 0;
                                x = ld_32bits_mem8_read();
                            }
                            uc(x, Ha);
                            break Fd;
                        case 0xab:
                        case 0xb3:
                        case 0xbb:
                            mem8 = phys_mem8[mem_ptr++];
                            Ha = regs[(mem8 >> 3) & 7];
                            Ja = (OPbyte >> 3) & 3;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = xc(Ja, regs[register_0], Ha);
                            } else {
                                mem8_loc = Pb(mem8);
                                mem8_loc = (mem8_loc + ((Ha >> 5) << 2)) >> 0;
                                x = ld_32bits_mem8_write();
                                x = xc(Ja, x, Ha);
                                wb(x);
                            }
                            break Fd;
                        case 0xbc:
                        case 0xbd:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ld_32bits_mem8_read();
                            }
                            if (OPbyte & 1)
                                regs[register_1] = Bc(regs[register_1], Ha);
                            else
                                regs[register_1] = zc(regs[register_1], Ha);
                            break Fd;
                        case 0xaf:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ld_32bits_mem8_read();
                            }
                            regs[register_1] = Wc(regs[register_1], Ha);
                            break Fd;
                        case 0x31:
                            if ((cpu.cr4 & (1 << 2)) && cpu.cpl != 0)
                                blow_up_errcode0(13);
                            x = current_cycle_count();
                            regs[0] = x >>> 0;
                            regs[2] = (x / 0x100000000) >>> 0;
                            break Fd;
                        case 0xc0:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                                Ha = do_8bit_math(0, x, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                set_either_two_bytes_of_reg_ABCD(register_1, x);
                                set_either_two_bytes_of_reg_ABCD(register_0, Ha);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                Ha = do_8bit_math(0, x, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                sb(Ha);
                                set_either_two_bytes_of_reg_ABCD(register_1, x);
                            }
                            break Fd;
                        case 0xc1:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = regs[register_0];
                                Ha = do_32bit_math(0, x, regs[register_1]);
                                regs[register_1] = x;
                                regs[register_0] = Ha;
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                Ha = do_32bit_math(0, x, regs[register_1]);
                                wb(Ha);
                                regs[register_1] = x;
                            }
                            break Fd;
                        case 0xb0:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                                Ha = do_8bit_math(5, regs[0], x);
                                if (Ha == 0) {
                                    set_either_two_bytes_of_reg_ABCD(register_0, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                } else {
                                    set_either_two_bytes_of_reg_ABCD(0, x);
                                }
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_8bits_mem8_write();
                                Ha = do_8bit_math(5, regs[0], x);
                                if (Ha == 0) {
                                    sb((regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                } else {
                                    set_either_two_bytes_of_reg_ABCD(0, x);
                                }
                            }
                            break Fd;
                        case 0xb1:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = regs[register_0];
                                Ha = do_32bit_math(5, regs[0], x);
                                if (Ha == 0) {
                                    regs[register_0] = regs[register_1];
                                } else {
                                    regs[0] = x;
                                }
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_32bits_mem8_write();
                                Ha = do_32bit_math(5, regs[0], x);
                                if (Ha == 0) {
                                    wb(regs[register_1]);
                                } else {
                                    regs[0] = x;
                                }
                            }
                            break Fd;
                        case 0xa0:
                        case 0xa8:
                            xd(cpu.segs[(OPbyte >> 3) & 7].selector);
                            break Fd;
                        case 0xa1:
                        case 0xa9:
                            Ie((OPbyte >> 3) & 7, Ad() & 0xffff);
                            Bd();
                            break Fd;
                        case 0xc8:
                        case 0xc9:
                        case 0xca:
                        case 0xcb:
                        case 0xcc:
                        case 0xcd:
                        case 0xce:
                        case 0xcf:
                            register_1 = OPbyte & 7;
                            x = regs[register_1];
                            x = (x >>> 24) | ((x >> 8) & 0x0000ff00) | ((x << 8) & 0x00ff0000) | (x << 24);
                            regs[register_1] = x;
                            break Fd;
                        case 0x04:
                        case 0x05:
                        case 0x07:
                        case 0x08:
                        case 0x09:
                        case 0x0a:
                        case 0x0b:
                        case 0x0c:
                        case 0x0d:
                        case 0x0e:
                        case 0x0f:
                        case 0x10:
                        case 0x11:
                        case 0x12:
                        case 0x13:
                        case 0x14:
                        case 0x15:
                        case 0x16:
                        case 0x17:
                        case 0x18:
                        case 0x19:
                        case 0x1a:
                        case 0x1b:
                        case 0x1c:
                        case 0x1d:
                        case 0x1e:
                        case 0x1f:
                        case 0x21:
                        case 0x24:
                        case 0x25:
                        case 0x26:
                        case 0x27:
                        case 0x28:
                        case 0x29:
                        case 0x2a:
                        case 0x2b:
                        case 0x2c:
                        case 0x2d:
                        case 0x2e:
                        case 0x2f:
                        case 0x30:
                        case 0x32:
                        case 0x33:
                        case 0x34:
                        case 0x35:
                        case 0x36:
                        case 0x37:
                        case 0x38:
                        case 0x39:
                        case 0x3a:
                        case 0x3b:
                        case 0x3c:
                        case 0x3d:
                        case 0x3e:
                        case 0x3f:
                        case 0x50:
                        case 0x51:
                        case 0x52:
                        case 0x53:
                        case 0x54:
                        case 0x55:
                        case 0x56:
                        case 0x57:
                        case 0x58:
                        case 0x59:
                        case 0x5a:
                        case 0x5b:
                        case 0x5c:
                        case 0x5d:
                        case 0x5e:
                        case 0x5f:
                        case 0x60:
                        case 0x61:
                        case 0x62:
                        case 0x63:
                        case 0x64:
                        case 0x65:
                        case 0x66:
                        case 0x67:
                        case 0x68:
                        case 0x69:
                        case 0x6a:
                        case 0x6b:
                        case 0x6c:
                        case 0x6d:
                        case 0x6e:
                        case 0x6f:
                        case 0x70:
                        case 0x71:
                        case 0x72:
                        case 0x73:
                        case 0x74:
                        case 0x75:
                        case 0x76:
                        case 0x77:
                        case 0x78:
                        case 0x79:
                        case 0x7a:
                        case 0x7b:
                        case 0x7c:
                        case 0x7d:
                        case 0x7e:
                        case 0x7f:
                        case 0xa6:
                        case 0xa7:
                        case 0xaa:
                        case 0xae:
                        case 0xb8:
                        case 0xb9:
                        case 0xc2:
                        case 0xc3:
                        case 0xc4:
                        case 0xc5:
                        case 0xc6:
                        case 0xc7:
                        case 0xd0:
                        case 0xd1:
                        case 0xd2:
                        case 0xd3:
                        case 0xd4:
                        case 0xd5:
                        case 0xd6:
                        case 0xd7:
                        case 0xd8:
                        case 0xd9:
                        case 0xda:
                        case 0xdb:
                        case 0xdc:
                        case 0xdd:
                        case 0xde:
                        case 0xdf:
                        case 0xe0:
                        case 0xe1:
                        case 0xe2:
                        case 0xe3:
                        case 0xe4:
                        case 0xe5:
                        case 0xe6:
                        case 0xe7:
                        case 0xe8:
                        case 0xe9:
                        case 0xea:
                        case 0xeb:
                        case 0xec:
                        case 0xed:
                        case 0xee:
                        case 0xef:
                        case 0xf0:
                        case 0xf1:
                        case 0xf2:
                        case 0xf3:
                        case 0xf4:
                        case 0xf5:
                        case 0xf6:
                        case 0xf7:
                        case 0xf8:
                        case 0xf9:
                        case 0xfa:
                        case 0xfb:
                        case 0xfc:
                        case 0xfd:
                        case 0xfe:
                        case 0xff:
                        default:
                            blow_up_errcode0(6);
                    }
                    break;
                default:
                    switch (OPbyte) {
                        case 0x189:
                            mem8 = phys_mem8[mem_ptr++];
                            x = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                set_lower_two_bytes_of_register(mem8 & 7, x);
                            } else {
                                mem8_loc = Pb(mem8);
                                ub(x);
                            }
                            break Fd;
                        case 0x18b:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register((mem8 >> 3) & 7, x);
                            break Fd;
                        case 0x1b8:
                        case 0x1b9:
                        case 0x1ba:
                        case 0x1bb:
                        case 0x1bc:
                        case 0x1bd:
                        case 0x1be:
                        case 0x1bf:
                            set_lower_two_bytes_of_register(OPbyte & 7, Ob());
                            break Fd;
                        case 0x1a1:
                            mem8_loc = Ub();
                            x = ld_16bits_mem8_read();
                            set_lower_two_bytes_of_register(0, x);
                            break Fd;
                        case 0x1a3:
                            mem8_loc = Ub();
                            ub(regs[0]);
                            break Fd;
                        case 0x1c7:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = Ob();
                                set_lower_two_bytes_of_register(mem8 & 7, x);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = Ob();
                                ub(x);
                            }
                            break Fd;
                        case 0x191:
                        case 0x192:
                        case 0x193:
                        case 0x194:
                        case 0x195:
                        case 0x196:
                        case 0x197:
                            register_1 = OPbyte & 7;
                            x = regs[0];
                            set_lower_two_bytes_of_register(0, regs[register_1]);
                            set_lower_two_bytes_of_register(register_1, x);
                            break Fd;
                        case 0x187:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = regs[register_0];
                                set_lower_two_bytes_of_register(register_0, regs[register_1]);
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_write();
                                ub(regs[register_1]);
                            }
                            set_lower_two_bytes_of_register(register_1, x);
                            break Fd;
                        case 0x1c4:
                            Vf(0);
                            break Fd;
                        case 0x1c5:
                            Vf(3);
                            break Fd;
                        case 0x101:
                        case 0x109:
                        case 0x111:
                        case 0x119:
                        case 0x121:
                        case 0x129:
                        case 0x131:
                        case 0x139:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (OPbyte >> 3) & 7;
                            Ha = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, do_16bit_math(Ja, regs[register_0], Ha));
                            } else {
                                mem8_loc = Pb(mem8);
                                if (Ja != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(Ja, x, Ha);
                                    ub(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, Ha);
                                }
                            }
                            break Fd;
                        case 0x103:
                        case 0x10b:
                        case 0x113:
                        case 0x11b:
                        case 0x123:
                        case 0x12b:
                        case 0x133:
                        case 0x13b:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (OPbyte >> 3) & 7;
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ld_16bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(register_1, do_16bit_math(Ja, regs[register_1], Ha));
                            break Fd;
                        case 0x105:
                        case 0x10d:
                        case 0x115:
                        case 0x11d:
                        case 0x125:
                        case 0x12d:
                        case 0x135:
                        case 0x13d:
                            Ha = Ob();
                            Ja = (OPbyte >> 3) & 7;
                            set_lower_two_bytes_of_register(0, do_16bit_math(Ja, regs[0], Ha));
                            break Fd;
                        case 0x181:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                Ha = Ob();
                                regs[register_0] = do_16bit_math(Ja, regs[register_0], Ha);
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = Ob();
                                if (Ja != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(Ja, x, Ha);
                                    ub(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, Ha);
                                }
                            }
                            break Fd;
                        case 0x183:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                Ha = ((phys_mem8[mem_ptr++] << 24) >> 24);
                                set_lower_two_bytes_of_register(register_0, do_16bit_math(Ja, regs[register_0], Ha));
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ((phys_mem8[mem_ptr++] << 24) >> 24);
                                if (Ja != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(Ja, x, Ha);
                                    ub(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, Ha);
                                }
                            }
                            break Fd;
                        case 0x140:
                        case 0x141:
                        case 0x142:
                        case 0x143:
                        case 0x144:
                        case 0x145:
                        case 0x146:
                        case 0x147:
                            register_1 = OPbyte & 7;
                            set_lower_two_bytes_of_register(register_1, ec(regs[register_1]));
                            break Fd;
                        case 0x148:
                        case 0x149:
                        case 0x14a:
                        case 0x14b:
                        case 0x14c:
                        case 0x14d:
                        case 0x14e:
                        case 0x14f:
                            register_1 = OPbyte & 7;
                            set_lower_two_bytes_of_register(register_1, fc(regs[register_1]));
                            break Fd;
                        case 0x16b:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ld_16bits_mem8_read();
                            }
                            Ia = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            set_lower_two_bytes_of_register(register_1, Rc(Ha, Ia));
                            break Fd;
                        case 0x169:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = ld_16bits_mem8_read();
                            }
                            Ia = Ob();
                            set_lower_two_bytes_of_register(register_1, Rc(Ha, Ia));
                            break Fd;
                        case 0x185:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            Ha = regs[(mem8 >> 3) & 7];
                            {
                                _dst = (((x & Ha) << 16) >> 16);
                                _op = 13;
                            }
                            break Fd;
                        case 0x1a9:
                            Ha = Ob();
                            {
                                _dst = (((regs[0] & Ha) << 16) >> 16);
                                _op = 13;
                            }
                            break Fd;
                        case 0x1f7:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    Ha = Ob();
                                    {
                                        _dst = (((x & Ha) << 16) >> 16);
                                        _op = 13;
                                    }
                                    break;
                                case 2:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, ~regs[register_0]);
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = ~x;
                                        ub(x);
                                    }
                                    break;
                                case 3:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, do_16bit_math(5, 0, regs[register_0]));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = do_16bit_math(5, 0, x);
                                        ub(x);
                                    }
                                    break;
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    x = Qc(regs[0], x);
                                    set_lower_two_bytes_of_register(0, x);
                                    set_lower_two_bytes_of_register(2, x >> 16);
                                    break;
                                case 5:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    x = Rc(regs[0], x);
                                    set_lower_two_bytes_of_register(0, x);
                                    set_lower_two_bytes_of_register(2, x >> 16);
                                    break;
                                case 6:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    Fc(x);
                                    break;
                                case 7:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    Gc(x);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x1c1:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                Ha = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(Ja, regs[register_0], Ha));
                            } else {
                                mem8_loc = Pb(mem8);
                                Ha = phys_mem8[mem_ptr++];
                                x = ld_16bits_mem8_write();
                                x = shift16(Ja, x, Ha);
                                ub(x);
                            }
                            break Fd;
                        case 0x1d1:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(Ja, regs[register_0], 1));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_write();
                                x = shift16(Ja, x, 1);
                                ub(x);
                            }
                            break Fd;
                        case 0x1d3:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            Ha = regs[1] & 0xff;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(Ja, regs[register_0], Ha));
                            } else {
                                mem8_loc = Pb(mem8);
                                x = ld_16bits_mem8_write();
                                x = shift16(Ja, x, Ha);
                                ub(x);
                            }
                            break Fd;
                        case 0x198:
                            set_lower_two_bytes_of_register(0, (regs[0] << 24) >> 24);
                            break Fd;
                        case 0x199:
                            set_lower_two_bytes_of_register(2, (regs[0] << 16) >> 31);
                            break Fd;
                        case 0x190:
                            break Fd;
                        case 0x150:
                        case 0x151:
                        case 0x152:
                        case 0x153:
                        case 0x154:
                        case 0x155:
                        case 0x156:
                        case 0x157:
                            vd(regs[OPbyte & 7]);
                            break Fd;
                        case 0x158:
                        case 0x159:
                        case 0x15a:
                        case 0x15b:
                        case 0x15c:
                        case 0x15d:
                        case 0x15e:
                        case 0x15f:
                            x = yd();
                            zd();
                            set_lower_two_bytes_of_register(OPbyte & 7, x);
                            break Fd;
                        case 0x160:
                            Jf();
                            break Fd;
                        case 0x161:
                            Lf();
                            break Fd;
                        case 0x18f:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = yd();
                                zd();
                                set_lower_two_bytes_of_register(mem8 & 7, x);
                            } else {
                                x = yd();
                                Ha = regs[4];
                                zd();
                                Ia = regs[4];
                                mem8_loc = Pb(mem8);
                                regs[4] = Ha;
                                ub(x);
                                regs[4] = Ia;
                            }
                            break Fd;
                        case 0x168:
                            x = Ob();
                            vd(x);
                            break Fd;
                        case 0x16a:
                            x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            vd(x);
                            break Fd;
                        case 0x1c8:
                            Pf();
                            break Fd;
                        case 0x1c9:
                            Nf();
                            break Fd;
                        case 0x106:
                        case 0x10e:
                        case 0x116:
                        case 0x11e:
                            vd(cpu.segs[(OPbyte >> 3) & 3].selector);
                            break Fd;
                        case 0x107:
                        case 0x117:
                        case 0x11f:
                            Ie((OPbyte >> 3) & 3, yd());
                            zd();
                            break Fd;
                        case 0x18d:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3)
                                blow_up_errcode0(6);
                            CS_flags = (CS_flags & ~0x000f) | (6 + 1);
                            set_lower_two_bytes_of_register((mem8 >> 3) & 7, Pb(mem8));
                            break Fd;
                        case 0x1ff:
                            mem8 = phys_mem8[mem_ptr++];
                            Ja = (mem8 >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, ec(regs[register_0]));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = ec(x);
                                        ub(x);
                                    }
                                    break;
                                case 1:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, fc(regs[register_0]));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = fc(x);
                                        ub(x);
                                    }
                                    break;
                                case 2:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    vd((eip + mem_ptr - initial_mem_ptr));
                                    eip = x, mem_ptr = initial_mem_ptr = 0;
                                    break;
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    eip = x, mem_ptr = initial_mem_ptr = 0;
                                    break;
                                case 6:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    vd(x);
                                    break;
                                case 3:
                                case 5:
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    mem8_loc = Pb(mem8);
                                    x = ld_16bits_mem8_read();
                                    mem8_loc = (mem8_loc + 2) >> 0;
                                    Ha = ld_16bits_mem8_read();
                                    if (Ja == 3)
                                        Ze(0, Ha, x, (eip + mem_ptr - initial_mem_ptr));
                                    else
                                        Oe(Ha, x);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x1eb:
                            x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1e9:
                            x = Ob();
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x170:
                        case 0x171:
                        case 0x172:
                        case 0x173:
                        case 0x174:
                        case 0x175:
                        case 0x176:
                        case 0x177:
                        case 0x178:
                        case 0x179:
                        case 0x17a:
                        case 0x17b:
                        case 0x17c:
                        case 0x17d:
                        case 0x17e:
                        case 0x17f:
                            x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            Ha = check_status_bits_for_jump(OPbyte & 0xf);
                            if (Ha)
                                eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1c2:
                            Ha = (Ob() << 16) >> 16;
                            x = yd();
                            regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 2 + Ha) & SS_mask);
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1c3:
                            x = yd();
                            zd();
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1e8:
                            x = Ob();
                            vd((eip + mem_ptr - initial_mem_ptr));
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x162:
                            If();
                            break Fd;
                        case 0x1a5:
                            lg();
                            break Fd;
                        case 0x1a7:
                            ng();
                            break Fd;
                        case 0x1ad:
                            og();
                            break Fd;
                        case 0x1af:
                            pg();
                            break Fd;
                        case 0x1ab:
                            mg();
                            break Fd;
                        case 0x16d:
                            jg();
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x16f:
                            kg();
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1e5:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                blow_up_errcode0(13);
                            x = phys_mem8[mem_ptr++];
                            set_lower_two_bytes_of_register(0, cpu.ld16_port(x));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1e7:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                blow_up_errcode0(13);
                            x = phys_mem8[mem_ptr++];
                            cpu.st16_port(x, regs[0] & 0xffff);
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1ed:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                blow_up_errcode0(13);
                            set_lower_two_bytes_of_register(0, cpu.ld16_port(regs[2] & 0xffff));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1ef:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                blow_up_errcode0(13);
                            cpu.st16_port(regs[2] & 0xffff, regs[0] & 0xffff);
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x166:
                        case 0x167:
                        case 0x1f0:
                        case 0x1f2:
                        case 0x1f3:
                        case 0x126:
                        case 0x12e:
                        case 0x136:
                        case 0x13e:
                        case 0x164:
                        case 0x165:
                        case 0x100:
                        case 0x108:
                        case 0x110:
                        case 0x118:
                        case 0x120:
                        case 0x128:
                        case 0x130:
                        case 0x138:
                        case 0x102:
                        case 0x10a:
                        case 0x112:
                        case 0x11a:
                        case 0x122:
                        case 0x12a:
                        case 0x132:
                        case 0x13a:
                        case 0x104:
                        case 0x10c:
                        case 0x114:
                        case 0x11c:
                        case 0x124:
                        case 0x12c:
                        case 0x134:
                        case 0x13c:
                        case 0x1a0:
                        case 0x1a2:
                        case 0x1d8:
                        case 0x1d9:
                        case 0x1da:
                        case 0x1db:
                        case 0x1dc:
                        case 0x1dd:
                        case 0x1de:
                        case 0x1df:
                        case 0x184:
                        case 0x1a8:
                        case 0x1f6:
                        case 0x1c0:
                        case 0x1d0:
                        case 0x1d2:
                        case 0x1fe:
                        case 0x1cd:
                        case 0x1ce:
                        case 0x1f5:
                        case 0x1f8:
                        case 0x1f9:
                        case 0x1fc:
                        case 0x1fd:
                        case 0x1fa:
                        case 0x1fb:
                        case 0x19e:
                        case 0x19f:
                        case 0x1f4:
                        case 0x127:
                        case 0x12f:
                        case 0x137:
                        case 0x13f:
                        case 0x1d4:
                        case 0x1d5:
                        case 0x16c:
                        case 0x16e:
                        case 0x1a4:
                        case 0x1a6:
                        case 0x1aa:
                        case 0x1ac:
                        case 0x1ae:
                        case 0x180:
                        case 0x182:
                        case 0x186:
                        case 0x188:
                        case 0x18a:
                        case 0x18c:
                        case 0x18e:
                        case 0x19b:
                        case 0x1b0:
                        case 0x1b1:
                        case 0x1b2:
                        case 0x1b3:
                        case 0x1b4:
                        case 0x1b5:
                        case 0x1b6:
                        case 0x1b7:
                        case 0x1c6:
                        case 0x1cc:
                        case 0x1d7:
                        case 0x1e4:
                        case 0x1e6:
                        case 0x1ec:
                        case 0x1ee:
                        case 0x1cf:
                        case 0x1ca:
                        case 0x1cb:
                        case 0x19a:
                        case 0x19c:
                        case 0x19d:
                        case 0x1ea:
                        case 0x1e0:
                        case 0x1e1:
                        case 0x1e2:
                        case 0x1e3:
                            OPbyte &= 0xff;
                            break;
                        case 0x163:
                        case 0x1d6:
                        case 0x1f1:
                        default:
                            blow_up_errcode0(6);
                        case 0x10f:
                            OPbyte = phys_mem8[mem_ptr++];
                            OPbyte |= 0x0100;
                            switch (OPbyte) {
                                case 0x180:
                                case 0x181:
                                case 0x182:
                                case 0x183:
                                case 0x184:
                                case 0x185:
                                case 0x186:
                                case 0x187:
                                case 0x188:
                                case 0x189:
                                case 0x18a:
                                case 0x18b:
                                case 0x18c:
                                case 0x18d:
                                case 0x18e:
                                case 0x18f:
                                    x = Ob();
                                    if (check_status_bits_for_jump(OPbyte & 0xf))
                                        eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                                    break Fd;
                                case 0x140:
                                case 0x141:
                                case 0x142:
                                case 0x143:
                                case 0x144:
                                case 0x145:
                                case 0x146:
                                case 0x147:
                                case 0x148:
                                case 0x149:
                                case 0x14a:
                                case 0x14b:
                                case 0x14c:
                                case 0x14d:
                                case 0x14e:
                                case 0x14f:
                                    mem8 = phys_mem8[mem_ptr++];
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    if (check_status_bits_for_jump(OPbyte & 0xf))
                                        set_lower_two_bytes_of_register((mem8 >> 3) & 7, x);
                                    break Fd;
                                case 0x1b6:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1)) & 0xff;
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_8bits_mem8_read();
                                    }
                                    set_lower_two_bytes_of_register(register_1, x);
                                    break Fd;
                                case 0x1be:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_8bits_mem8_read();
                                    }
                                    set_lower_two_bytes_of_register(register_1, (((x) << 24) >> 24));
                                    break Fd;
                                case 0x1af:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        Ha = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        Ha = ld_16bits_mem8_read();
                                    }
                                    set_lower_two_bytes_of_register(register_1, Rc(regs[register_1], Ha));
                                    break Fd;
                                case 0x1c1:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = regs[register_0];
                                        Ha = do_16bit_math(0, x, regs[register_1]);
                                        set_lower_two_bytes_of_register(register_1, x);
                                        set_lower_two_bytes_of_register(register_0, Ha);
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        Ha = do_16bit_math(0, x, regs[register_1]);
                                        ub(Ha);
                                        set_lower_two_bytes_of_register(register_1, x);
                                    }
                                    break Fd;
                                case 0x1a0:
                                case 0x1a8:
                                    vd(cpu.segs[(OPbyte >> 3) & 7].selector);
                                    break Fd;
                                case 0x1a1:
                                case 0x1a9:
                                    Ie((OPbyte >> 3) & 7, yd());
                                    zd();
                                    break Fd;
                                case 0x1b2:
                                case 0x1b4:
                                case 0x1b5:
                                    Vf(OPbyte & 7);
                                    break Fd;
                                case 0x1a4:
                                case 0x1ac:
                                    mem8 = phys_mem8[mem_ptr++];
                                    Ha = regs[(mem8 >> 3) & 7];
                                    Ja = (OPbyte >> 3) & 1;
                                    if ((mem8 >> 6) == 3) {
                                        Ia = phys_mem8[mem_ptr++];
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, oc(Ja, regs[register_0], Ha, Ia));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        Ia = phys_mem8[mem_ptr++];
                                        x = ld_16bits_mem8_write();
                                        x = oc(Ja, x, Ha, Ia);
                                        ub(x);
                                    }
                                    break Fd;
                                case 0x1a5:
                                case 0x1ad:
                                    mem8 = phys_mem8[mem_ptr++];
                                    Ha = regs[(mem8 >> 3) & 7];
                                    Ia = regs[1];
                                    Ja = (OPbyte >> 3) & 1;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, oc(Ja, regs[register_0], Ha, Ia));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = oc(Ja, x, Ha, Ia);
                                        ub(x);
                                    }
                                    break Fd;
                                case 0x1ba:
                                    mem8 = phys_mem8[mem_ptr++];
                                    Ja = (mem8 >> 3) & 7;
                                    switch (Ja) {
                                        case 4:
                                            if ((mem8 >> 6) == 3) {
                                                x = regs[mem8 & 7];
                                                Ha = phys_mem8[mem_ptr++];
                                            } else {
                                                mem8_loc = Pb(mem8);
                                                Ha = phys_mem8[mem_ptr++];
                                                x = ld_16bits_mem8_read();
                                            }
                                            tc(x, Ha);
                                            break;
                                        case 5:
                                        case 6:
                                        case 7:
                                            if ((mem8 >> 6) == 3) {
                                                register_0 = mem8 & 7;
                                                Ha = phys_mem8[mem_ptr++];
                                                regs[register_0] = vc(Ja & 3, regs[register_0], Ha);
                                            } else {
                                                mem8_loc = Pb(mem8);
                                                Ha = phys_mem8[mem_ptr++];
                                                x = ld_16bits_mem8_write();
                                                x = vc(Ja & 3, x, Ha);
                                                ub(x);
                                            }
                                            break;
                                        default:
                                            blow_up_errcode0(6);
                                    }
                                    break Fd;
                                case 0x1a3:
                                    mem8 = phys_mem8[mem_ptr++];
                                    Ha = regs[(mem8 >> 3) & 7];
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        mem8_loc = (mem8_loc + (((Ha & 0xffff) >> 4) << 1)) >> 0;
                                        x = ld_16bits_mem8_read();
                                    }
                                    tc(x, Ha);
                                    break Fd;
                                case 0x1ab:
                                case 0x1b3:
                                case 0x1bb:
                                    mem8 = phys_mem8[mem_ptr++];
                                    Ha = regs[(mem8 >> 3) & 7];
                                    Ja = (OPbyte >> 3) & 3;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, vc(Ja, regs[register_0], Ha));
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        mem8_loc = (mem8_loc + (((Ha & 0xffff) >> 4) << 1)) >> 0;
                                        x = ld_16bits_mem8_write();
                                        x = vc(Ja, x, Ha);
                                        ub(x);
                                    }
                                    break Fd;
                                case 0x1bc:
                                case 0x1bd:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        Ha = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        Ha = ld_16bits_mem8_read();
                                    }
                                    x = regs[register_1];
                                    if (OPbyte & 1)
                                        x = Ac(x, Ha);
                                    else
                                        x = yc(x, Ha);
                                    set_lower_two_bytes_of_register(register_1, x);
                                    break Fd;
                                case 0x1b1:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = regs[register_0];
                                        Ha = do_16bit_math(5, regs[0], x);
                                        if (Ha == 0) {
                                            set_lower_two_bytes_of_register(register_0, regs[register_1]);
                                        } else {
                                            set_lower_two_bytes_of_register(0, x);
                                        }
                                    } else {
                                        mem8_loc = Pb(mem8);
                                        x = ld_16bits_mem8_write();
                                        Ha = do_16bit_math(5, regs[0], x);
                                        if (Ha == 0) {
                                            ub(regs[register_1]);
                                        } else {
                                            set_lower_two_bytes_of_register(0, x);
                                        }
                                    }
                                    break Fd;
                                case 0x100:
                                case 0x101:
                                case 0x102:
                                case 0x103:
                                case 0x120:
                                case 0x122:
                                case 0x106:
                                case 0x123:
                                case 0x1a2:
                                case 0x131:
                                case 0x190:
                                case 0x191:
                                case 0x192:
                                case 0x193:
                                case 0x194:
                                case 0x195:
                                case 0x196:
                                case 0x197:
                                case 0x198:
                                case 0x199:
                                case 0x19a:
                                case 0x19b:
                                case 0x19c:
                                case 0x19d:
                                case 0x19e:
                                case 0x19f:
                                case 0x1b0:
                                    OPbyte = 0x0f;
                                    mem_ptr--;
                                    break;
                                case 0x104:
                                case 0x105:
                                case 0x107:
                                case 0x108:
                                case 0x109:
                                case 0x10a:
                                case 0x10b:
                                case 0x10c:
                                case 0x10d:
                                case 0x10e:
                                case 0x10f:
                                case 0x110:
                                case 0x111:
                                case 0x112:
                                case 0x113:
                                case 0x114:
                                case 0x115:
                                case 0x116:
                                case 0x117:
                                case 0x118:
                                case 0x119:
                                case 0x11a:
                                case 0x11b:
                                case 0x11c:
                                case 0x11d:
                                case 0x11e:
                                case 0x11f:
                                case 0x121:
                                case 0x124:
                                case 0x125:
                                case 0x126:
                                case 0x127:
                                case 0x128:
                                case 0x129:
                                case 0x12a:
                                case 0x12b:
                                case 0x12c:
                                case 0x12d:
                                case 0x12e:
                                case 0x12f:
                                case 0x130:
                                case 0x132:
                                case 0x133:
                                case 0x134:
                                case 0x135:
                                case 0x136:
                                case 0x137:
                                case 0x138:
                                case 0x139:
                                case 0x13a:
                                case 0x13b:
                                case 0x13c:
                                case 0x13d:
                                case 0x13e:
                                case 0x13f:
                                case 0x150:
                                case 0x151:
                                case 0x152:
                                case 0x153:
                                case 0x154:
                                case 0x155:
                                case 0x156:
                                case 0x157:
                                case 0x158:
                                case 0x159:
                                case 0x15a:
                                case 0x15b:
                                case 0x15c:
                                case 0x15d:
                                case 0x15e:
                                case 0x15f:
                                case 0x160:
                                case 0x161:
                                case 0x162:
                                case 0x163:
                                case 0x164:
                                case 0x165:
                                case 0x166:
                                case 0x167:
                                case 0x168:
                                case 0x169:
                                case 0x16a:
                                case 0x16b:
                                case 0x16c:
                                case 0x16d:
                                case 0x16e:
                                case 0x16f:
                                case 0x170:
                                case 0x171:
                                case 0x172:
                                case 0x173:
                                case 0x174:
                                case 0x175:
                                case 0x176:
                                case 0x177:
                                case 0x178:
                                case 0x179:
                                case 0x17a:
                                case 0x17b:
                                case 0x17c:
                                case 0x17d:
                                case 0x17e:
                                case 0x17f:
                                case 0x1a6:
                                case 0x1a7:
                                case 0x1aa:
                                case 0x1ae:
                                case 0x1b7:
                                case 0x1b8:
                                case 0x1b9:
                                case 0x1bf:
                                case 0x1c0:
                                default:
                                    blow_up_errcode0(6);
                            }
                            break;
                    }
            }
        }
    } while (--cycles_left); //End Giant Core DO WHILE Execution Loop
    this.cycle_count += (N_cycles - cycles_left);
    this.eip           = (eip + mem_ptr - initial_mem_ptr);
    this.cc_src        = _src;
    this.cc_dst        = _dst;
    this.cc_op         = _op;
    this.cc_op2        = _op2;
    this.cc_dst2       = _dst2;
    return La;
};


CPU_X86.prototype.exec = function(N_cycles) {
    var Dg, La, final_cycle_count, va;
    final_cycle_count = this.cycle_count + N_cycles;
    La = 256;
    va = null;
    while (this.cycle_count < final_cycle_count) {
        try {
            La = this.exec_internal(final_cycle_count - this.cycle_count, va);
            if (La != 256)
                break;
            va = null;
        } catch (Fg) {
            if (Fg.hasOwnProperty("intno")) {
                va = Fg;
            } else {
                throw Fg;
            }
        }
    }
    return La;
};

CPU_X86.prototype.load_binary_ie9 = function(Gg, mem8_loc) {
    var Hg, Ig, tg, i;
    Hg = new XMLHttpRequest();
    Hg.open('GET', Gg, false);
    Hg.send(null);
    if (Hg.status != 200 && Hg.status != 0) {
        throw "Error while loading " + Gg;
    }
    Ig = new VBArray(Hg.responseBody).toArray();
    tg = Ig.length;
    for (i = 0; i < tg; i++) {
        this.st8_phys(mem8_loc + i, Ig[i]);
    }
    return tg;
};

CPU_X86.prototype.load_binary = function(Gg, mem8_loc) {
    var Hg, Ig, tg, i, Jg, Kg;
    if (typeof ActiveXObject == "function")
        return this.load_binary_ie9(Gg, mem8_loc);
    Hg = new XMLHttpRequest();
    Hg.open('GET', Gg, false);
    Kg = ('ArrayBuffer' in window && 'Uint8Array' in window);
    if (Kg && 'mozResponseType' in Hg) {
        Hg.mozResponseType = 'arraybuffer';
    } else if (Kg && 'responseType' in Hg) {
        Hg.responseType = 'arraybuffer';
    } else {
        Hg.overrideMimeType('text/plain; charset=x-user-defined');
        Kg = false;
    }
    Hg.send(null);
    if (Hg.status != 200 && Hg.status != 0) {
        throw "Error while loading " + Gg;
    }
    if (Kg && 'mozResponse' in Hg) {
        Ig = Hg.mozResponse;
    } else if (Kg && Hg.mozResponseArrayBuffer) {
        Ig = Hg.mozResponseArrayBuffer;
    } else if ('responseType' in Hg) {
        Ig = Hg.response;
    } else {
        Ig = Hg.responseText;
        Kg = false;
    }
    if (Kg) {
        tg = Ig.byteLength;
        Jg = new Uint8Array(Ig, 0, tg);
        for (i = 0; i < tg; i++) {
            this.st8_phys(mem8_loc + i, Jg[i]);
        }
    } else {
        tg = Ig.length;
        for (i = 0; i < tg; i++) {
            this.st8_phys(mem8_loc + i, Ig.charCodeAt(i));
        }
    }
    return tg;
};


function Lg(a) {
    return ((a / 10) << 4) | (a % 10);
}
function CMOS(Ng) {
    var Og, d;
    Og = new Uint8Array(128);
    this.cmos_data = Og;
    this.cmos_index = 0;
    d = new Date();
    Og[0] = Lg(d.getUTCSeconds());
    Og[2] = Lg(d.getUTCMinutes());
    Og[4] = Lg(d.getUTCHours());
    Og[6] = Lg(d.getUTCDay());
    Og[7] = Lg(d.getUTCDate());
    Og[8] = Lg(d.getUTCMonth() + 1);
    Og[9] = Lg(d.getUTCFullYear() % 100);
    Og[10] = 0x26;
    Og[11] = 0x02;
    Og[12] = 0x00;
    Og[13] = 0x80;
    Og[0x14] = 0x02;
    Ng.register_ioport_write(0x70, 2, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x70, 2, 1, this.ioport_read.bind(this));
}
CMOS.prototype.ioport_write = function(mem8_loc, Ig) {
    if (mem8_loc == 0x70) {
        this.cmos_index = Ig & 0x7f;
    }
};
CMOS.prototype.ioport_read = function(mem8_loc) {
    var Pg;
    if (mem8_loc == 0x70) {
        return 0xff;
    } else {
        Pg = this.cmos_data[this.cmos_index];
        if (this.cmos_index == 10)
            this.cmos_data[10] ^= 0x80;
        else if (this.cmos_index == 12)
            this.cmos_data[12] = 0x00;
        return Pg;
    }
};

function Qg(Ng, Zf) {
    Ng.register_ioport_write(Zf, 2, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(Zf, 2, 1, this.ioport_read.bind(this));
    this.reset();
}
Qg.prototype.reset = function() {
    this.last_irr = 0;
    this.irr = 0;
    this.imr = 0;
    this.isr = 0;
    this.priority_add = 0;
    this.irq_base = 0;
    this.read_reg_select = 0;
    this.special_mask = 0;
    this.init_state = 0;
    this.auto_eoi = 0;
    this.rotate_on_autoeoi = 0;
    this.init4 = 0;
    this.elcr = 0;
    this.elcr_mask = 0;
};
Qg.prototype.set_irq1 = function(Rg, Qf) {
    var wc;
    wc = 1 << Rg;
    if (Qf) {
        if ((this.last_irr & wc) == 0)
            this.irr |= wc;
        this.last_irr |= wc;
    } else {
        this.last_irr &= ~wc;
    }
};
Qg.prototype.get_priority = function(wc) {
    var Sg;
    if (wc == 0)
        return -1;
    Sg = 7;
    while ((wc & (1 << ((Sg + this.priority_add) & 7))) == 0)
        Sg--;
    return Sg;
};
Qg.prototype.get_irq = function() {
    var wc, Tg, Sg;
    wc = this.irr & ~this.imr;
    Sg = this.get_priority(wc);
    if (Sg < 0)
        return -1;
    Tg = this.get_priority(this.isr);
    if (Sg > Tg) {
        return Sg;
    } else {
        return -1;
    }
};
Qg.prototype.intack = function(Rg) {
    if (this.auto_eoi) {
        if (this.rotate_on_auto_eoi)
            this.priority_add = (Rg + 1) & 7;
    } else {
        this.isr |= (1 << Rg);
    }
    if (!(this.elcr & (1 << Rg)))
        this.irr &= ~(1 << Rg);
};
Qg.prototype.ioport_write = function(mem8_loc, x) {
    var Sg;
    mem8_loc &= 1;
    if (mem8_loc == 0) {
        if (x & 0x10) {
            this.reset();
            this.init_state = 1;
            this.init4 = x & 1;
            if (x & 0x02)
                throw "single mode not supported";
            if (x & 0x08)
                throw "level sensitive irq not supported";
        } else if (x & 0x08) {
            if (x & 0x02)
                this.read_reg_select = x & 1;
            if (x & 0x40)
                this.special_mask = (x >> 5) & 1;
        } else {
            switch (x) {
                case 0x00:
                case 0x80:
                    this.rotate_on_autoeoi = x >> 7;
                    break;
                case 0x20:
                case 0xa0:
                    Sg = this.get_priority(this.isr);
                    if (Sg >= 0) {
                        this.isr &= ~(1 << ((Sg + this.priority_add) & 7));
                    }
                    if (x == 0xa0)
                        this.priority_add = (this.priority_add + 1) & 7;
                    break;
                case 0x60:
                case 0x61:
                case 0x62:
                case 0x63:
                case 0x64:
                case 0x65:
                case 0x66:
                case 0x67:
                    Sg = x & 7;
                    this.isr &= ~(1 << Sg);
                    break;
                case 0xc0:
                case 0xc1:
                case 0xc2:
                case 0xc3:
                case 0xc4:
                case 0xc5:
                case 0xc6:
                case 0xc7:
                    this.priority_add = (x + 1) & 7;
                    break;
                case 0xe0:
                case 0xe1:
                case 0xe2:
                case 0xe3:
                case 0xe4:
                case 0xe5:
                case 0xe6:
                case 0xe7:
                    Sg = x & 7;
                    this.isr &= ~(1 << Sg);
                    this.priority_add = (Sg + 1) & 7;
                    break;
            }
        }
    } else {
        switch (this.init_state) {
            case 0:
                this.imr = x;
                this.update_irq();
                break;
            case 1:
                this.irq_base = x & 0xf8;
                this.init_state = 2;
                break;
            case 2:
                if (this.init4) {
                    this.init_state = 3;
                } else {
                    this.init_state = 0;
                }
                break;
            case 3:
                this.auto_eoi = (x >> 1) & 1;
                this.init_state = 0;
                break;
        }
    }
};
Qg.prototype.ioport_read = function(Ug) {
    var mem8_loc, Pg;
    mem8_loc = Ug & 1;
    if (mem8_loc == 0) {
        if (this.read_reg_select)
            Pg = this.isr;
        else
            Pg = this.irr;
    } else {
        Pg = this.imr;
    }
    return Pg;
};









function PIC(Ng, Wg, Ug, Xg) {
    this.pics = new Array();
    this.pics[0] = new Qg(Ng, Wg);
    this.pics[1] = new Qg(Ng, Ug);
    this.pics[0].elcr_mask = 0xf8;
    this.pics[1].elcr_mask = 0xde;
    this.irq_requested = 0;
    this.cpu_set_irq = Xg;
    this.pics[0].update_irq = this.update_irq.bind(this);
    this.pics[1].update_irq = this.update_irq.bind(this);
}
PIC.prototype.update_irq = function() {
    var Yg, Rg;
    Yg = this.pics[1].get_irq();
    if (Yg >= 0) {
        this.pics[0].set_irq1(2, 1);
        this.pics[0].set_irq1(2, 0);
    }
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.cpu_set_irq(1);
    } else {
        this.cpu_set_irq(0);
    }
};
PIC.prototype.set_irq = function(Rg, Qf) {
    this.pics[Rg >> 3].set_irq1(Rg & 7, Qf);
    this.update_irq();
};
PIC.prototype.get_hard_intno = function() {
    var Rg, Yg, intno;
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.pics[0].intack(Rg);
        if (Rg == 2) {
            Yg = this.pics[1].get_irq();
            if (Yg >= 0) {
                this.pics[1].intack(Yg);
            } else {
                Yg = 7;
            }
            intno = this.pics[1].irq_base + Yg;
            Rg = Yg + 8;
        } else {
            intno = this.pics[0].irq_base + Rg;
        }
    } else {
        Rg = 7;
        intno = this.pics[0].irq_base + Rg;
    }
    this.update_irq();
    return intno;
};



function PIT(Ng, ah, bh) {
    var s, i;
    this.pit_channels = new Array();
    for (i = 0; i < 3; i++) {
        s = new IRQCH(bh);
        this.pit_channels[i] = s;
        s.mode = 3;
        s.gate = (i != 2) >> 0;
        s.pit_load_count(0);
    }
    this.speaker_data_on = 0;
    this.set_irq = ah;
    Ng.register_ioport_write(0x40, 4, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x40, 3, 1, this.ioport_read.bind(this));
    Ng.register_ioport_read(0x61, 1, 1, this.speaker_ioport_read.bind(this));
    Ng.register_ioport_write(0x61, 1, 1, this.speaker_ioport_write.bind(this));
}



function IRQCH(bh) {
    this.count = 0;
    this.latched_count = 0;
    this.rw_state = 0;
    this.mode = 0;
    this.bcd = 0;
    this.gate = 0;
    this.count_load_time = 0;
    this.get_ticks = bh;
    this.pit_time_unit = 1193182 / 2000000;
}
IRQCH.prototype.get_time = function() {
    return Math.floor(this.get_ticks() * this.pit_time_unit);
};
IRQCH.prototype.pit_get_count = function() {
    var d, dh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        case 0:
        case 1:
        case 4:
        case 5:
            dh = (this.count - d) & 0xffff;
            break;
        default:
            dh = this.count - (d % this.count);
            break;
    }
    return dh;
};
IRQCH.prototype.pit_get_out = function() {
    var d, eh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
        case 0:
            eh = (d >= this.count) >> 0;
            break;
        case 1:
            eh = (d < this.count) >> 0;
            break;
        case 2:
            if ((d % this.count) == 0 && d != 0)
                eh = 1;
            else
                eh = 0;
            break;
        case 3:
            eh = ((d % this.count) < (this.count >> 1)) >> 0;
            break;
        case 4:
        case 5:
            eh = (d == this.count) >> 0;
            break;
    }
    return eh;
};
IRQCH.prototype.get_next_transition_time = function() {
    var d, fh, base, gh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
        case 0:
        case 1:
            if (d < this.count)
                fh = this.count;
            else
                return -1;
            break;
        case 2:
            base = (d / this.count) * this.count;
            if ((d - base) == 0 && d != 0)
                fh = base + this.count;
            else
                fh = base + this.count + 1;
            break;
        case 3:
            base = (d / this.count) * this.count;
            gh = ((this.count + 1) >> 1);
            if ((d - base) < gh)
                fh = base + gh;
            else
                fh = base + this.count;
            break;
        case 4:
        case 5:
            if (d < this.count)
                fh = this.count;
            else if (d == this.count)
                fh = this.count + 1;
            else
                return -1;
            break;
    }
    fh = this.count_load_time + fh;
    return fh;
};
IRQCH.prototype.pit_load_count = function(x) {
    if (x == 0)
        x = 0x10000;
    this.count_load_time = this.get_time();
    this.count = x;
};



PIT.prototype.ioport_write = function(mem8_loc, x) {
    var hh, ih, s;
    mem8_loc &= 3;
    if (mem8_loc == 3) {
        hh = x >> 6;
        if (hh == 3)
            return;
        s = this.pit_channels[hh];
        ih = (x >> 4) & 3;
        switch (ih) {
            case 0:
                s.latched_count = s.pit_get_count();
                s.rw_state = 4;
                break;
            default:
                s.mode = (x >> 1) & 7;
                s.bcd = x & 1;
                s.rw_state = ih - 1 + 0;
                break;
        }
    } else {
        s = this.pit_channels[mem8_loc];
        switch (s.rw_state) {
            case 0:
                s.pit_load_count(x);
                break;
            case 1:
                s.pit_load_count(x << 8);
                break;
            case 2:
            case 3:
                if (s.rw_state & 1) {
                    s.pit_load_count((s.latched_count & 0xff) | (x << 8));
                } else {
                    s.latched_count = x;
                }
                s.rw_state ^= 1;
                break;
        }
    }
};
PIT.prototype.ioport_read = function(mem8_loc) {
    var Pg, ma, s;
    mem8_loc &= 3;
    s = this.pit_channels[mem8_loc];
    switch (s.rw_state) {
        case 0:
        case 1:
        case 2:
        case 3:
            ma = s.pit_get_count();
            if (s.rw_state & 1)
                Pg = (ma >> 8) & 0xff;
            else
                Pg = ma & 0xff;
            if (s.rw_state & 2)
                s.rw_state ^= 1;
            break;
        default:
        case 4:
        case 5:
            if (s.rw_state & 1)
                Pg = s.latched_count >> 8;
            else
                Pg = s.latched_count & 0xff;
            s.rw_state ^= 1;
            break;
    }
    return Pg;
};
PIT.prototype.speaker_ioport_write = function(mem8_loc, x) {
    this.speaker_data_on = (x >> 1) & 1;
    this.pit_channels[2].gate = x & 1;
};
PIT.prototype.speaker_ioport_read = function(mem8_loc) {
    var eh, s, x;
    s = this.pit_channels[2];
    eh = s.pit_get_out();
    x = (this.speaker_data_on << 1) | s.gate | (eh << 5);
    return x;
};
PIT.prototype.update_irq = function() {
    this.set_irq(1);
    this.set_irq(0);
};






function Serial(Ng, mem8_loc, kh, lh) {
    this.divider = 0;
    this.rbr = 0;
    this.ier = 0;
    this.iir = 0x01;
    this.lcr = 0;
    this.mcr;
    this.lsr = 0x40 | 0x20;
    this.msr = 0;
    this.scr = 0;
    this.set_irq_func = kh;
    this.write_func = lh;
    this.receive_fifo = "";
    Ng.register_ioport_write(0x3f8, 8, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x3f8, 8, 1, this.ioport_read.bind(this));
}
Serial.prototype.update_irq = function() {
    if ((this.lsr & 0x01) && (this.ier & 0x01)) {
        this.iir = 0x04;
    } else if ((this.lsr & 0x20) && (this.ier & 0x02)) {
        this.iir = 0x02;
    } else {
        this.iir = 0x01;
    }
    if (this.iir != 0x01) {
        this.set_irq_func(1);
    } else {
        this.set_irq_func(0);
    }
};
Serial.prototype.ioport_write = function(mem8_loc, x) {
    mem8_loc &= 7;
    switch (mem8_loc) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0xff00) | x;
            } else {
                this.lsr &= ~0x20;
                this.update_irq();
                this.write_func(String.fromCharCode(x));
                this.lsr |= 0x20;
                this.lsr |= 0x40;
                this.update_irq();
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0x00ff) | (x << 8);
            } else {
                this.ier = x;
                this.update_irq();
            }
            break;
        case 2:
            break;
        case 3:
            this.lcr = x;
            break;
        case 4:
            this.mcr = x;
            break;
        case 5:
            break;
        case 6:
            this.msr = x;
            break;
        case 7:
            this.scr = x;
            break;
    }
};
Serial.prototype.ioport_read = function(mem8_loc) {
    var Pg;
    mem8_loc &= 7;
    switch (mem8_loc) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                Pg = this.divider & 0xff;
            } else {
                Pg = this.rbr;
                this.lsr &= ~(0x01 | 0x10);
                this.update_irq();
                this.send_char_from_fifo();
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                Pg = (this.divider >> 8) & 0xff;
            } else {
                Pg = this.ier;
            }
            break;
        case 2:
            Pg = this.iir;
            break;
        case 3:
            Pg = this.lcr;
            break;
        case 4:
            Pg = this.mcr;
            break;
        case 5:
            Pg = this.lsr;
            break;
        case 6:
            Pg = this.msr;
            break;
        case 7:
            Pg = this.scr;
            break;
    }
    return Pg;
};
Serial.prototype.send_break = function() {
    this.rbr = 0;
    this.lsr |= 0x10 | 0x01;
    this.update_irq();
};
Serial.prototype.send_char = function(mh) {
    this.rbr = mh;
    this.lsr |= 0x01;
    this.update_irq();
};
Serial.prototype.send_char_from_fifo = function() {
    var nh;
    nh = this.receive_fifo;
    if (nh != "" && !(this.lsr & 0x01)) {
        this.send_char(nh.charCodeAt(0));
        this.receive_fifo = nh.substr(1, nh.length - 1);
    }
};
Serial.prototype.send_chars = function(na) {
    this.receive_fifo += na;
    this.send_char_from_fifo();
};



function KBD(Ng, ph) {
    Ng.register_ioport_read(0x64, 1, 1, this.read_status.bind(this));
    Ng.register_ioport_write(0x64, 1, 1, this.write_command.bind(this));
    this.reset_request = ph;
}
KBD.prototype.read_status = function(mem8_loc) {
    return 0;
};
KBD.prototype.write_command = function(mem8_loc, x) {
    switch (x) {
        case 0xfe:
            this.reset_request();
            break;
        default:
            break;
    }
};



function qh(Ng, Zf, rh, lh, sh) {
    Ng.register_ioport_read(Zf, 16, 4, this.ioport_readl.bind(this));
    Ng.register_ioport_write(Zf, 16, 4, this.ioport_writel.bind(this));
    Ng.register_ioport_read(Zf + 8, 1, 1, this.ioport_readb.bind(this));
    Ng.register_ioport_write(Zf + 8, 1, 1, this.ioport_writeb.bind(this));
    this.cur_pos = 0;
    this.doc_str = "";
    this.read_func = rh;
    this.write_func = lh;
    this.get_boot_time = sh;
}
qh.prototype.ioport_writeb = function(mem8_loc, x) {
    this.doc_str += String.fromCharCode(x);
};
qh.prototype.ioport_readb = function(mem8_loc) {
    var c, na, x;
    na = this.doc_str;
    if (this.cur_pos < na.length) {
        x = na.charCodeAt(this.cur_pos) & 0xff;
    } else {
        x = 0;
    }
    this.cur_pos++;
    return x;
};
qh.prototype.ioport_writel = function(mem8_loc, x) {
    var na;
    mem8_loc = (mem8_loc >> 2) & 3;
    switch (mem8_loc) {
        case 0:
            this.doc_str = this.doc_str.substr(0, x >>> 0);
            break;
        case 1:
            return this.cur_pos = x >>> 0;
        case 2:
            na = String.fromCharCode(x & 0xff) + String.fromCharCode((x >> 8) & 0xff) + String.fromCharCode((x >> 16) & 0xff) + String.fromCharCode((x >> 24) & 0xff);
            this.doc_str += na;
            break;
        case 3:
            this.write_func(this.doc_str);
    }
};
qh.prototype.ioport_readl = function(mem8_loc) {
    var x;
    mem8_loc = (mem8_loc >> 2) & 3;
    switch (mem8_loc) {
        case 0:
            this.doc_str = this.read_func();
            return this.doc_str.length >> 0;
        case 1:
            return this.cur_pos >> 0;
        case 2:
            x = this.ioport_readb(0);
            x |= this.ioport_readb(0) << 8;
            x |= this.ioport_readb(0) << 16;
            x |= this.ioport_readb(0) << 24;
            return x;
        case 3:
            if (this.get_boot_time)
                return this.get_boot_time() >> 0;
            else
                return 0;
    }
};

//used only in orig func "PIC"
function Xg(Qf) { this.hard_irq = Qf;}

// unused?
function th() { return this.cycle_count; }





function PCEmulator(uh) {
    var cpu;
    cpu = new CPU_X86();
    this.cpu = cpu;
    cpu.phys_mem_resize(uh.mem_size);
    this.init_ioports();
    this.register_ioport_write(0x80, 1, 1, this.ioport80_write);
    this.pic    = new PIC(this, 0x20, 0xa0, Xg.bind(cpu));
    this.pit    = new PIT(this, this.pic.set_irq.bind(this.pic, 0), th.bind(cpu));
    this.cmos   = new CMOS(this);
    this.serial = new Serial(this, 0x3f8, this.pic.set_irq.bind(this.pic, 4), uh.serial_write);
    this.kbd    = new KBD(this, this.reset.bind(this));
    this.reset_request = 0;
    if (uh.clipboard_get && uh.clipboard_set) {
        this.jsclipboard = new qh(this, 0x3c0, uh.clipboard_get, uh.clipboard_set, uh.get_boot_time);
    }
    cpu.ld8_port       = this.ld8_port.bind(this);
    cpu.ld16_port      = this.ld16_port.bind(this);
    cpu.ld32_port      = this.ld32_port.bind(this);
    cpu.st8_port       = this.st8_port.bind(this);
    cpu.st16_port      = this.st16_port.bind(this);
    cpu.st32_port      = this.st32_port.bind(this);
    cpu.get_hard_intno = this.pic.get_hard_intno.bind(this.pic);
}

PCEmulator.prototype.load_binary = function(Gg, ha) { return this.cpu.load_binary(Gg, ha); };

PCEmulator.prototype.start = function() { setTimeout(this.timer_func.bind(this), 10); };

PCEmulator.prototype.timer_func = function() {
    var La, vh, wh, xh, yh, Ng, cpu;
    Ng = this;
    cpu = Ng.cpu;
    wh = cpu.cycle_count + 100000;
    xh = false;
    yh = false;
    zh: while (cpu.cycle_count < wh) {
        Ng.pit.update_irq();
        La = cpu.exec(wh - cpu.cycle_count);
        if (La == 256) {
            if (Ng.reset_request) {
                xh = true;
                break;
            }
        } else if (La == 257) {
            yh = true;
            break;
        } else {
            xh = true;
            break;
        }
    }
    if (!xh) {
        if (yh) {
            setTimeout(this.timer_func.bind(this), 10);
        } else {
            setTimeout(this.timer_func.bind(this), 0);
        }
    }
};

PCEmulator.prototype.init_ioports = function() {
    var i, Ah, Bh;
    this.ioport_readb_table = new Array();
    this.ioport_writeb_table = new Array();
    this.ioport_readw_table = new Array();
    this.ioport_writew_table = new Array();
    this.ioport_readl_table = new Array();
    this.ioport_writel_table = new Array();
    Ah = this.default_ioport_readw.bind(this);
    Bh = this.default_ioport_writew.bind(this);
    for (i = 0; i < 1024; i++) {
        this.ioport_readb_table[i] = this.default_ioport_readb;
        this.ioport_writeb_table[i] = this.default_ioport_writeb;
        this.ioport_readw_table[i] = Ah;
        this.ioport_writew_table[i] = Bh;
        this.ioport_readl_table[i] = this.default_ioport_readl;
        this.ioport_writel_table[i] = this.default_ioport_writel;
    }
};

PCEmulator.prototype.default_ioport_readb = function(Zf) {
    var x;
    x = 0xff;
    return x;
};

PCEmulator.prototype.default_ioport_readw = function(Zf) {
    var x;
    x = this.ioport_readb_table[Zf](Zf);
    Zf = (Zf + 1) & (1024 - 1);
    x |= this.ioport_readb_table[Zf](Zf) << 8;
    return x;
};

PCEmulator.prototype.default_ioport_readl = function(Zf) {
    var x;
    x = -1;
    return x;
};

PCEmulator.prototype.default_ioport_writeb = function(Zf, x) {};

PCEmulator.prototype.default_ioport_writew = function(Zf, x) {
    this.ioport_writeb_table[Zf](Zf, x & 0xff);
    Zf = (Zf + 1) & (1024 - 1);
    this.ioport_writeb_table[Zf](Zf, (x >> 8) & 0xff);
};

PCEmulator.prototype.default_ioport_writel = function(Zf, x) {};

PCEmulator.prototype.ld8_port = function(Zf) {
    var x;
    x = this.ioport_readb_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.ld16_port = function(Zf) {
    var x;
    x = this.ioport_readw_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.ld32_port = function(Zf) {
    var x;
    x = this.ioport_readl_table[Zf & (1024 - 1)](Zf);
    return x;
};

PCEmulator.prototype.st8_port  = function(Zf, x) { this.ioport_writeb_table[Zf & (1024 - 1)](Zf, x); };
PCEmulator.prototype.st16_port = function(Zf, x) { this.ioport_writew_table[Zf & (1024 - 1)](Zf, x); };
PCEmulator.prototype.st32_port = function(Zf, x) { this.ioport_writel_table[Zf & (1024 - 1)](Zf, x); };

PCEmulator.prototype.register_ioport_read = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_readb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_readw_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_readl_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.register_ioport_write = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_writeb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_writew_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_writel_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.ioport80_write = function(mem8_loc, Ig) {};
PCEmulator.prototype.reset = function() { this.request_request = 1; };



































































