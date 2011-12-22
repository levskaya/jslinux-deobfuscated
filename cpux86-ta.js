/*
Fabrix - An annotated version of the original JSLinux which is Copyright (c) 2011 Fabrice Bellard

x86 CPU (circa 486 sans FPU) Emulator
-----------------------------------------

Useful references:
------------------------------
http://ref.x86asm.net/coder32.html#xC4
http://en.wikibooks.org/wiki/X86_Assembly/X86_Architecture
http://en.wikipedia.org/wiki/X86
http://en.wikipedia.org/wiki/Control_register
http://en.wikipedia.org/wiki/X86_assembly_language
http://en.wikipedia.org/wiki/Translation_lookaside_buffer

http://bellard.org/jslinux/tech.html :

""
The exact restrictions of the emulated
CPU are: No FPU/MMX/SSE No segment limit and right checks when
accessing memory (Linux does not rely on them for memory protection,
so it is not an issue. The x86 emulator of QEMU has the same
restriction).  No single-stepping I added some tricks which are not
present in QEMU to be more precise when emulating unaligned
load/stores at page boundaries. The condition code emulation is also
more efficient than the one in QEMU.
""


Hints for Bit Twiddling
-----------------------------------------------------
X & -65281  = mask for lower 8 bits for 32bit X
X & 3       = mask for lower 2 bits for single byte X

*/

/* Parity Check by LUT:
static const bool ParityTable256[256] = {
#   define P2(n) n, n^1, n^1, n
#   define P4(n) P2(n), P2(n^1), P2(n^1), P2(n)
#   define P6(n) P4(n), P4(n^1), P4(n^1), P4(n)
    P6(0), P6(1), P6(1), P6(0) };
unsigned char b;  // byte value to compute the parity of
bool parity = ParityTable256[b];
// OR, for 32-bit words:    unsigned int v; v ^= v >> 16; v ^= v >> 8; bool parity = ParityTable256[v & 0xff];
// Variation:               unsigned char * p = (unsigned char *) &v; parity = ParityTable256[p[0] ^ p[1] ^ p[2] ^ p[3]]; */
var parity_LUT = [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];

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
    */
    this.regs = new Array(); // EAX, EBX, ECX, EDX, ESI, EDI, ESP, EBP  32bit registers
    for (i = 0; i < 8; i++) {
        this.regs[i] = 0;
    }
    /* IP/EIP/RIP: Instruction pointer. Holds the program counter, the current instruction address. */
    this.eip         = 0; //instruction pointer
    this.cc_op       = 0; // current op
    this.cc_dst      = 0; // current dest
    this.cc_src      = 0; // current src
    this.cc_op2      = 0; // current op, byte2
    this.cc_dst2     = 0; // current dest, byte2

    this.df          = 1; // Direction Flag

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
    /*
      x,y,z,v are either just general non-local values or their exact specialization is unclear, esp. x,y look like they're used for everything
     */
    var cpu, mem8_loc, regs;
    var _src, _dst, _op, _op2, _dst2;
    var CS_flags, mem8, register_0, OPbyte, register_1, x, y, z, conditional_var, cycles_left, exit_code, v;
    var CS_base, SS_base, SS_mask, FS_usage_flag, init_CS_flags, iopl;//io privilege level
    var phys_mem8, last_tlb_val;
    var phys_mem16, phys_mem32;
    var tlb_read_kernel, tlb_write_kernel, tlb_read_user, tlb_write_user, _tlb_read_, _tlb_write_;

    /* Storing XOR values as small lookup table is software equivalent of a Translation Lookaside Buffer (TLB) */
    function __ld_8bits_mem8_read() {
        var tlb_lookup;
        do_tlb_set_page(mem8_loc, 0, cpu.cpl == 3);
        tlb_lookup = _tlb_read_[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[tlb_lookup];
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
        var tlb_lookup;
        do_tlb_set_page(mem8_loc, 1, cpu.cpl == 3);
        tlb_lookup = _tlb_write_[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[tlb_lookup];
    }
    function ld_8bits_mem8_write() {
        var tlb_lookup;
        return ((tlb_lookup = _tlb_write_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_write() : phys_mem8[mem8_loc ^ tlb_lookup];
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
        var tlb_lookup;
        return ((tlb_lookup = _tlb_write_[mem8_loc >>> 12]) | mem8_loc) & 1 ? __ld_16bits_mem8_write() : phys_mem16[(mem8_loc ^ tlb_lookup) >> 1];
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
        var tlb_lookup;
        return ((tlb_lookup = _tlb_write_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_write() : phys_mem32[(mem8_loc ^ tlb_lookup) >> 2];
    }
    function __st8_mem8_write(x) {
        var tlb_lookup;
        do_tlb_set_page(mem8_loc, 1, cpu.cpl == 3);
        tlb_lookup = _tlb_write_[mem8_loc >>> 12] ^ mem8_loc;
        phys_mem8[tlb_lookup] = x;
    }
    function st8_mem8_write(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if (last_tlb_val == -1) {
                __st8_mem8_write(x);
            } else {
                phys_mem8[mem8_loc ^ last_tlb_val] = x;
            }
        }
    }
    function __st16_mem8_write(x) {
        st8_mem8_write(x);
        mem8_loc++;
        st8_mem8_write(x >> 8);
        mem8_loc--;
    }
    function st16_mem8_write(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if ((last_tlb_val | mem8_loc) & 1) {
                __st16_mem8_write(x);
            } else {
                phys_mem16[(mem8_loc ^ last_tlb_val) >> 1] = x;
            }
        }
    }
    function __st32_mem8_write(x) {
        st8_mem8_write(x);
        mem8_loc++;
        st8_mem8_write(x >> 8);
        mem8_loc++;
        st8_mem8_write(x >> 16);
        mem8_loc++;
        st8_mem8_write(x >> 24);
        mem8_loc -= 3;
    }
    function st32_mem8_write(x) {
        var last_tlb_val;
        {
            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
            if ((last_tlb_val | mem8_loc) & 3) {
                __st32_mem8_write(x);
            } else {
                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
            }
        }
    }
    function __ld8_mem8_kernel_read() {
        var tlb_lookup;
        do_tlb_set_page(mem8_loc, 0, 0);
        tlb_lookup = tlb_read_kernel[mem8_loc >>> 12] ^ mem8_loc;
        return phys_mem8[tlb_lookup];
    }
    function ld8_mem8_kernel_read() {
        var tlb_lookup;
        return ((tlb_lookup = tlb_read_kernel[mem8_loc >>> 12]) == -1) ? __ld8_mem8_kernel_read() : phys_mem8[mem8_loc ^ tlb_lookup];
    }
    function __ld16_mem8_kernel_read() {
        var x;
        x = ld8_mem8_kernel_read();
        mem8_loc++;
        x |= ld8_mem8_kernel_read() << 8;
        mem8_loc--;
        return x;
    }
    function ld16_mem8_kernel_read() {
        var tlb_lookup;
        return ((tlb_lookup = tlb_read_kernel[mem8_loc >>> 12]) | mem8_loc) & 1 ? __ld16_mem8_kernel_read() : phys_mem16[(mem8_loc ^ tlb_lookup) >> 1];
    }
    function __ld32_mem8_kernel_read() {
        var x;
        x = ld8_mem8_kernel_read();
        mem8_loc++;
        x |= ld8_mem8_kernel_read() << 8;
        mem8_loc++;
        x |= ld8_mem8_kernel_read() << 16;
        mem8_loc++;
        x |= ld8_mem8_kernel_read() << 24;
        mem8_loc -= 3;
        return x;
    }
    function ld32_mem8_kernel_read() {
        var tlb_lookup;
        return ((tlb_lookup = tlb_read_kernel[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld32_mem8_kernel_read() : phys_mem32[(mem8_loc ^ tlb_lookup) >> 2];
    }
    function __st8_mem8_kernel_write(x) {
        var tlb_lookup;
        do_tlb_set_page(mem8_loc, 1, 0);
        tlb_lookup = tlb_write_kernel[mem8_loc >>> 12] ^ mem8_loc;
        phys_mem8[tlb_lookup] = x;
    }
    function st8_mem8_kernel_write(x) {
        var tlb_lookup;
        tlb_lookup = tlb_write_kernel[mem8_loc >>> 12];
        if (tlb_lookup == -1) {
            __st8_mem8_kernel_write(x);
        } else {
            phys_mem8[mem8_loc ^ tlb_lookup] = x;
        }
    }
    function __st16_mem8_kernel_write(x) {
        st8_mem8_kernel_write(x);
        mem8_loc++;
        st8_mem8_kernel_write(x >> 8);
        mem8_loc--;
    }
    function st16_mem8_kernel_write(x) {
        var tlb_lookup;
        tlb_lookup = tlb_write_kernel[mem8_loc >>> 12];
        if ((tlb_lookup | mem8_loc) & 1) {
            __st16_mem8_kernel_write(x);
        } else {
            phys_mem16[(mem8_loc ^ tlb_lookup) >> 1] = x;
        }
    }
    function __st32_mem8_kernel_write(x) {
        st8_mem8_kernel_write(x);
        mem8_loc++;
        st8_mem8_kernel_write(x >> 8);
        mem8_loc++;
        st8_mem8_kernel_write(x >> 16);
        mem8_loc++;
        st8_mem8_kernel_write(x >> 24);
        mem8_loc -= 3;
    }
    function st32_mem8_kernel_write(x) {
        var tlb_lookup;
        tlb_lookup = tlb_write_kernel[mem8_loc >>> 12];
        if ((tlb_lookup | mem8_loc) & 3) {
            __st32_mem8_kernel_write(x);
        } else {
            phys_mem32[(mem8_loc ^ tlb_lookup) >> 2] = x;
        }
    }
    var eip, mem_ptr, Lb, initial_mem_ptr, Nb;
    function ld16_mem8_direct() {
        var x, y;
        x = phys_mem8[mem_ptr++];
        y = phys_mem8[mem_ptr++];
        return x | (y << 8);
    }
    function giant_get_mem8_loc_func(mem8) {
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
                mem8_loc = ld16_mem8_direct();
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
                        mem8_loc = ld16_mem8_direct();
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
            mem8_loc = ld16_mem8_direct();
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
    function do_32bit_math(conditional_var, Yb, Zb) {
        var ac;
        switch (conditional_var) {
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
    function do_16bit_math(conditional_var, Yb, Zb) {
        var ac;
        switch (conditional_var) {
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
    function increment_16bit(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x + 1) << 16) >> 16);
        _op = 26;
        return _dst;
    }
    function decrement_16bit(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x - 1) << 16) >> 16);
        _op = 29;
        return _dst;
    }
    function do_8bit_math(conditional_var, Yb, Zb) {
        var ac;
        switch (conditional_var) {
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
    function increment_8bit(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x + 1) << 24) >> 24);
        _op = 25;
        return _dst;
    }
    function decrement_8bit(x) {
        if (_op < 25) {
            _op2 = _op;
            _dst2 = _dst;
        }
        _dst = (((x - 1) << 24) >> 24);
        _op = 28;
        return _dst;
    }
    function shift8(conditional_var, Yb, Zb) {
        var kc, ac;
        switch (conditional_var) {
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
                throw "unsupported shift8=" + conditional_var;
        }
        return Yb;
    }
    function shift16(conditional_var, Yb, Zb) {
        var kc, ac;
        switch (conditional_var) {
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
                throw "unsupported shift16=" + conditional_var;
        }
        return Yb;
    }
    function shift32(conditional_var, Yb, Zb) {
        var kc, ac;
        switch (conditional_var) {
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
                throw "unsupported shift32=" + conditional_var;
        }
        return Yb;
    }

    /* Bit Twiddling Functions --------------------------------------------------------------------------------*/

    function oc(conditional_var, Yb, Zb, pc) {
        var qc;
        pc &= 0x1f;
        if (pc) {
            if (conditional_var == 0) {
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
    function vc(conditional_var, Yb, Zb) {
        var wc;
        Zb &= 0xf;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (conditional_var) {
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
    function xc(conditional_var, Yb, Zb) {
        var wc;
        Zb &= 0x1f;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (conditional_var) {
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
            v = (a % OPbyte) >> 0;
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
            v = Ic >> 0;
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
            v = (-v) >> 0;
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
            v = 0;
            r &= -1;
        } else {
            Jc = a & 0xffff;
            Ic = a >>> 16;
            Tc = OPbyte & 0xffff;
            Uc = OPbyte >>> 16;
            r = Jc * Tc;
            v = Ic * Uc;
            m = Jc * Uc;
            r += (((m & 0xffff) << 16) >>> 0);
            v += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                v++;
            }
            m = Ic * Tc;
            r += (((m & 0xffff) << 16) >>> 0);
            v += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                v++;
            }
            r &= -1;
            v &= -1;
        }
        return r;
    }
    function Vc(a, OPbyte) {
        _dst = Sc(a, OPbyte);
        _src = v;
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
            v = ~v;
            r = (-r) >> 0;
            if (r == 0) {
                v = (v + 1) >> 0;
            }
        }
        _dst = r;
        _src = (v - (r >> 31)) >> 0;
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
            return parity_LUT[_dst & 0xff];
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
        var tlb_lookup;
        if (ud) {
            tlb_lookup = _tlb_write_[mem8_loc >>> 12];
        } else {
            tlb_lookup = _tlb_read_[mem8_loc >>> 12];
        }
        if (tlb_lookup == -1) {
            do_tlb_set_page(mem8_loc, ud, cpu.cpl == 3);
            if (ud) {
                tlb_lookup = _tlb_write_[mem8_loc >>> 12];
            } else {
                tlb_lookup = _tlb_read_[mem8_loc >>> 12];
            }
        }
        return tlb_lookup ^ mem8_loc;
    }
    function vd(x) {
        var wd;
        wd = regs[4] - 2;
        mem8_loc = ((wd & SS_mask) + SS_base) >> 0;
        st16_mem8_write(x);
        regs[4] = (regs[4] & ~SS_mask) | ((wd) & SS_mask);
    }
    function xd(x) {
        var wd;
        wd = regs[4] - 4;
        mem8_loc = ((wd & SS_mask) + SS_base) >> 0;
        st32_mem8_write(x);
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
        var n, CS_flags, l, mem8, Dd, base, conditional_var, Ed;
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
                    conditional_var = (mem8 >> 3) & 7;
                    if (conditional_var == 0) {
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
                    conditional_var = (mem8 >> 3) & 7;
                    if (conditional_var == 0) {
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
        Yd = ld32_mem8_kernel_read();
        mem8_loc += 4;
        Wd = ld32_mem8_kernel_read();
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
            le = ld16_mem8_kernel_read();
            mem8_loc += 2;
        } else {
            le = ld32_mem8_kernel_read();
            mem8_loc += 4;
        }
        ke = ld16_mem8_kernel_read();
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
        Yd = ld32_mem8_kernel_read();
        mem8_loc += 4;
        Wd = ld32_mem8_kernel_read();
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
                        st32_mem8_kernel_write(cpu.segs[5].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st32_mem8_kernel_write(cpu.segs[4].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st32_mem8_kernel_write(cpu.segs[3].selector);
                    }
                    {
                        le = (le - 4) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st32_mem8_kernel_write(cpu.segs[0].selector);
                    }
                }
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st32_mem8_kernel_write(cpu.segs[2].selector);
                }
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st32_mem8_kernel_write(regs[4]);
                }
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st32_mem8_kernel_write(id());
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st32_mem8_kernel_write(cpu.segs[1].selector);
            }
            {
                le = (le - 4) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st32_mem8_kernel_write(ye);
            }
            if (te) {
                {
                    le = (le - 4) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st32_mem8_kernel_write(error_code);
                }
            }
        } else {
            if (ue) {
                if (cpu.eflags & 0x00020000) {
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[5].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[4].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[3].selector);
                    }
                    {
                        le = (le - 2) & -1;
                        mem8_loc = (qe + (le & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[0].selector);
                    }
                }
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st16_mem8_kernel_write(cpu.segs[2].selector);
                }
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st16_mem8_kernel_write(regs[4]);
                }
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st16_mem8_kernel_write(id());
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st16_mem8_kernel_write(cpu.segs[1].selector);
            }
            {
                le = (le - 2) & -1;
                mem8_loc = (qe + (le & SS_mask)) & -1;
                st16_mem8_kernel_write(ye);
            }
            if (te) {
                {
                    le = (le - 2) & -1;
                    mem8_loc = (qe + (le & SS_mask)) & -1;
                    st16_mem8_kernel_write(error_code);
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
        ve = ld16_mem8_kernel_read();
        mem8_loc = (mem8_loc + 2) >> 0;
        selector = ld16_mem8_kernel_read();
        le = regs[4];
        if (ne)
            ye = oe;
        else
            ye = eip;
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            st16_mem8_write(id());
        }
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            st16_mem8_write(cpu.segs[1].selector);
        }
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            st16_mem8_write(ye);
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
            Yd = ld32_mem8_kernel_read();
            mem8_loc += 4;
            Wd = ld32_mem8_kernel_read();
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
            Yd = ld32_mem8_kernel_read();
            mem8_loc += 4;
            Wd = ld32_mem8_kernel_read();
            ie = (Wd >> 8) & 0xf;
            if ((Wd & (1 << 12)) || (ie != 1 && ie != 9))
                blow_up(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                blow_up(11, selector & 0xfffc);
            be(cpu.tr, Yd, Wd);
            Wd |= (1 << 9);
            st32_mem8_kernel_write(Wd);
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
            Yd = ld32_mem8_kernel_read();
            mem8_loc += 4;
            Wd = ld32_mem8_kernel_read();
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
                st32_mem8_kernel_write(Wd);
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
                st32_mem8_write(cpu.segs[1].selector);
            }
            {
                le = (le - 4) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                st32_mem8_write(oe);
            }
        } else {
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                st16_mem8_write(cpu.segs[1].selector);
            }
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                st16_mem8_write(oe);
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
                        st32_mem8_kernel_write(cpu.segs[1].selector);
                    }
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st32_mem8_kernel_write(oe);
                    }
                } else {
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[1].selector);
                    }
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st16_mem8_kernel_write(oe);
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
                        st32_mem8_kernel_write(cpu.segs[2].selector);
                    }
                    {
                        Te = (Te - 4) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st32_mem8_kernel_write(We);
                    }
                    for (i = Se - 1; i >= 0; i--) {
                        x = Xe(Ve + ((We + i * 4) & Ue));
                        {
                            Te = (Te - 4) & -1;
                            mem8_loc = (qe + (Te & SS_mask)) & -1;
                            st32_mem8_kernel_write(x);
                        }
                    }
                } else {
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st16_mem8_kernel_write(cpu.segs[2].selector);
                    }
                    {
                        Te = (Te - 2) & -1;
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        st16_mem8_kernel_write(We);
                    }
                    for (i = Se - 1; i >= 0; i--) {
                        x = Ye(Ve + ((We + i * 2) & Ue));
                        {
                            Te = (Te - 2) & -1;
                            mem8_loc = (qe + (Te & SS_mask)) & -1;
                            st16_mem8_kernel_write(x);
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
                    st32_mem8_kernel_write(cpu.segs[1].selector);
                }
                {
                    Te = (Te - 4) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    st32_mem8_kernel_write(oe);
                }
            } else {
                {
                    Te = (Te - 2) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    st16_mem8_kernel_write(cpu.segs[1].selector);
                }
                {
                    Te = (Te - 2) & -1;
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    st16_mem8_kernel_write(oe);
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
                Le = ld32_mem8_kernel_read();
                Te = (Te + 4) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = ld32_mem8_kernel_read();
                Te = (Te + 4) & -1;
            }
            Ke &= 0xffff;
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = ld32_mem8_kernel_read();
                Te = (Te + 4) & -1;
            }
        } else {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = ld16_mem8_kernel_read();
                Te = (Te + 2) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = ld16_mem8_kernel_read();
                Te = (Te + 2) & -1;
            }
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = ld16_mem8_kernel_read();
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
        var se, he, He, ef, iopl;
        var qe, Te, Le, wd, SS_mask;
        SS_mask = SS_mask_from_flags(cpu.segs[2].flags);
        Te = regs[4];
        qe = cpu.segs[2].base;
        df = 0;
        if (je == 1) {
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Le = ld32_mem8_kernel_read();
                Te = (Te + 4) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = ld32_mem8_kernel_read();
                Te = (Te + 4) & -1;
            }
            Ke &= 0xffff;
            if (bf) {
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    df = ld32_mem8_kernel_read();
                    Te = (Te + 4) & -1;
                }
                if (df & 0x00020000) {
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        wd = ld32_mem8_kernel_read();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        gf = ld32_mem8_kernel_read();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        hf = ld32_mem8_kernel_read();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        jf = ld32_mem8_kernel_read();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        kf = ld32_mem8_kernel_read();
                        Te = (Te + 4) & -1;
                    }
                    {
                        mem8_loc = (qe + (Te & SS_mask)) & -1;
                        lf = ld32_mem8_kernel_read();
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
                Le = ld16_mem8_kernel_read();
                Te = (Te + 2) & -1;
            }
            {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                Ke = ld16_mem8_kernel_read();
                Te = (Te + 2) & -1;
            }
            if (bf) {
                mem8_loc = (qe + (Te & SS_mask)) & -1;
                df = ld16_mem8_kernel_read();
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
                    wd = ld32_mem8_kernel_read();
                    Te = (Te + 4) & -1;
                }
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    gf = ld32_mem8_kernel_read();
                    Te = (Te + 4) & -1;
                }
                gf &= 0xffff;
            } else {
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    wd = ld16_mem8_kernel_read();
                    Te = (Te + 2) & -1;
                }
                {
                    mem8_loc = (qe + (Te & SS_mask)) & -1;
                    gf = ld16_mem8_kernel_read();
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
            iopl = (cpu.eflags >> 12) & 3;
            if (se <= iopl)
                ef |= 0x00000200;
            if (je == 0)
                ef &= 0xffff;
            kd(df, ef);
        }
    }
    function mf(je) {
        var iopl;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            if (cpu.eflags & 0x00020000) {
                iopl = (cpu.eflags >> 12) & 3;
                if (iopl != 3)
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
            mem8_loc = giant_get_mem8_loc_func(mem8);
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
        var mem8, x, y, register_0;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
            blow_up_errcode0(6);
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 6) == 3) {
            register_0 = mem8 & 7;
            x = regs[register_0] & 0xffff;
        } else {
            mem8_loc = giant_get_mem8_loc_func(mem8);
            x = ld_16bits_mem8_write();
        }
        y = regs[(mem8 >> 3) & 7];
        _src = hd();
        if ((x & 3) < (y & 3)) {
            x = (x & ~3) | (y & 3);
            if ((mem8 >> 6) == 3) {
                set_lower_two_bytes_of_register(register_0, x);
            } else {
                st16_mem8_write(x);
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
        jd |= parity_LUT[wf] << 2;
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
        jd |= parity_LUT[wf] << 2;
        jd |= (wf & 0x80);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function checkOp_BOUND() {
        var mem8, x, y, z;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = giant_get_mem8_loc_func(mem8);
        x = ld_32bits_mem8_read();
        mem8_loc = (mem8_loc + 4) & -1;
        y = ld_32bits_mem8_read();
        register_1 = (mem8 >> 3) & 7;
        z = regs[register_1];
        if (z < x || z > y)
            blow_up_errcode0(5);
    }
    function If() {
        var mem8, x, y, z;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = giant_get_mem8_loc_func(mem8);
        x = (ld_16bits_mem8_read() << 16) >> 16;
        mem8_loc = (mem8_loc + 2) & -1;
        y = (ld_16bits_mem8_read() << 16) >> 16;
        register_1 = (mem8 >> 3) & 7;
        z = (regs[register_1] << 16) >> 16;
        if (z < x || z > y)
            blow_up_errcode0(5);
    }
    function Jf() {
        var x, y, register_1;
        y = (regs[4] - 16) >> 0;
        mem8_loc = ((y & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            x = regs[register_1];
            st16_mem8_write(x);
            mem8_loc = (mem8_loc + 2) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((y) & SS_mask);
    }
    function Kf() {
        var x, y, register_1;
        y = (regs[4] - 32) >> 0;
        mem8_loc = ((y & SS_mask) + SS_base) >> 0;
        for (register_1 = 7; register_1 >= 0; register_1--) {
            x = regs[register_1];
            st32_mem8_write(x);
            mem8_loc = (mem8_loc + 4) >> 0;
        }
        regs[4] = (regs[4] & ~SS_mask) | ((y) & SS_mask);
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
        var x, y;
        y = regs[5];
        mem8_loc = ((y & SS_mask) + SS_base) >> 0;
        x = ld_16bits_mem8_read();
        set_lower_two_bytes_of_register(5, x);
        regs[4] = (regs[4] & ~SS_mask) | ((y + 2) & SS_mask);
    }
    function Of() {
        var x, y;
        y = regs[5];
        mem8_loc = ((y & SS_mask) + SS_base) >> 0;
        x = ld_32bits_mem8_read();
        regs[5] = x;
        regs[4] = (regs[4] & ~SS_mask) | ((y + 4) & SS_mask);
    }
    function Pf() {
        var cf, Qf, le, Rf, x, Sf;
        cf = ld16_mem8_direct();
        Qf = phys_mem8[mem_ptr++];
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 2) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            st16_mem8_write(Rf);
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
                    st16_mem8_write(x);
                }
                Qf--;
            }
            {
                le = (le - 2) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                st16_mem8_write(Sf);
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
        cf = ld16_mem8_direct();
        Qf = phys_mem8[mem_ptr++];
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 4) >> 0;
            mem8_loc = ((le & SS_mask) + SS_base) >> 0;
            st32_mem8_write(Rf);
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
                    st32_mem8_write(x);
                }
                Qf--;
            }
            {
                le = (le - 4) >> 0;
                mem8_loc = ((le & SS_mask) + SS_base) >> 0;
                st32_mem8_write(Sf);
            }
        }
        le = (le - cf) >> 0;
        mem8_loc = ((le & SS_mask) + SS_base) >> 0;
        ld_32bits_mem8_write();
        regs[5] = (regs[5] & ~SS_mask) | (Sf & SS_mask);
        regs[4] = (regs[4] & ~SS_mask) | ((le) & SS_mask);
    }
    function Uf(Sb) {
        var x, y, mem8;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = giant_get_mem8_loc_func(mem8);
        x = ld_32bits_mem8_read();
        mem8_loc += 4;
        y = ld_16bits_mem8_read();
        Ie(Sb, y);
        regs[(mem8 >> 3) & 7] = x;
    }
    function Vf(Sb) {
        var x, y, mem8;
        mem8 = phys_mem8[mem_ptr++];
        if ((mem8 >> 3) == 3)
            blow_up_errcode0(6);
        mem8_loc = giant_get_mem8_loc_func(mem8);
        x = ld_16bits_mem8_read();
        mem8_loc += 2;
        y = ld_16bits_mem8_read();
        Ie(Sb, y);
        set_lower_two_bytes_of_register((mem8 >> 3) & 7, x);
    }
    function stringOp_INSB() {
        var Xf, Yf, Zf, ag, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
            st8_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld8_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            st8_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function stringOp_OUTSB() {
        var Xf, cg, Sb, ag, Zf, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
    function stringOp_MOVSB() {
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
                st8_mem8_write(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_8bits_mem8_read();
            mem8_loc = eg;
            st8_mem8_write(x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function stringOp_STOSB() {
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
                st8_mem8_write(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            st8_mem8_write(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function stringOp_CMPSB() {
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
            y = ld_8bits_mem8_read();
            do_8bit_math(7, x, y);
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
            y = ld_8bits_mem8_read();
            do_8bit_math(7, x, y);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function stringOp_LODSB() {
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
    function stringOp_SCASB() {
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
        var Xf, Yf, Zf, ag, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
            st16_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld16_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            st16_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function kg() {
        var Xf, cg, Sb, ag, Zf, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
                st16_mem8_write(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_16bits_mem8_read();
            mem8_loc = eg;
            st16_mem8_write(x);
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
                st16_mem8_write(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            st16_mem8_write(regs[0]);
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
            y = ld_16bits_mem8_read();
            do_16bit_math(7, x, y);
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
            y = ld_16bits_mem8_read();
            do_16bit_math(7, x, y);
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
    function stringOp_INSD() {
        var Xf, Yf, Zf, ag, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
            st32_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                mem_ptr = initial_mem_ptr;
        } else {
            x = cpu.ld32_port(Zf);
            mem8_loc = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            st32_mem8_write(x);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function stringOp_OUTSD() {
        var Xf, cg, Sb, ag, Zf, iopl, x;
        iopl = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > iopl)
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
    function stringOp_MOVSD() {
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
                st32_mem8_write(x);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            x = ld_32bits_mem8_read();
            mem8_loc = eg;
            st32_mem8_write(x);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function stringOp_STOSD() {
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
                st32_mem8_write(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    mem_ptr = initial_mem_ptr;
            }
        } else {
            st32_mem8_write(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function stringOp_CMPSD() {
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
            y = ld_32bits_mem8_read();
            do_32bit_math(7, x, y);
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
            y = ld_32bits_mem8_read();
            do_32bit_math(7, x, y);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function stringOp_LODSD() {
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
    function stringOp_SCASD() {
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
    exit_code = 256;
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
                    for (y = 0; y < x; y++) {
                        mem8_loc = (Nb + y) >> 0;
                        phys_mem8[mem_ptr + y] = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
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
                case 0x66://   Operand-size override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    if (init_CS_flags & 0x0100)
                        CS_flags &= ~0x0100;
                    else
                        CS_flags |= 0x0100;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x67://   Address-size override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    if (init_CS_flags & 0x0080)
                        CS_flags &= ~0x0080;
                    else
                        CS_flags |= 0x0080;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf0://LOCK   Assert LOCK# Signal Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0040;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf2://REPNZ  eCX Repeat String Operation Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0020;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xf3://REPZ  eCX Repeat String Operation Prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags |= 0x0010;
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x26://ES ES  ES segment override prefix
                case 0x2e://CS CS  CS segment override prefix
                case 0x36://SS SS  SS segment override prefix
                case 0x3e://DS DS  DS segment override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags = (CS_flags & ~0x000f) | (((OPbyte >> 3) & 3) + 1);
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0x64://FS FS  FS segment override prefix
                case 0x65://GS GS  GS segment override prefix
                    if (CS_flags == init_CS_flags)
                        Cd(Nb, OPbyte);
                    CS_flags = (CS_flags & ~0x000f) | ((OPbyte & 7) + 1);
                    OPbyte = phys_mem8[mem_ptr++];
                    OPbyte |= (CS_flags & 0x0100);
                    break;
                case 0xb0://MOV Ib Zb Move
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
                case 0xb8://MOV Ivqp Zvqp Move
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
                case 0x88://MOV Gb Eb Move
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    x = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        last_tlb_val = (register_0 & 4) << 1;
                        regs[register_0 & 3] = (regs[register_0 & 3] & ~(0xff << last_tlb_val)) | (((x) & 0xff) << last_tlb_val);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        {
                            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
                            if (last_tlb_val == -1) {
                                __st8_mem8_write(x);
                            } else {
                                phys_mem8[mem8_loc ^ last_tlb_val] = x;
                            }
                        }
                    }
                    break Fd;
                case 0x89://MOV Gvqp Evqp Move
                    mem8 = phys_mem8[mem_ptr++];
                    x = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        regs[mem8 & 7] = x;
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        {
                            last_tlb_val = _tlb_write_[mem8_loc >>> 12];
                            if ((last_tlb_val | mem8_loc) & 3) {
                                __st32_mem8_write(x);
                            } else {
                                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
                            }
                        }
                    }
                    break Fd;
                case 0x8a://MOV Eb Gb Move
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                    }
                    register_1 = (mem8 >> 3) & 7;
                    last_tlb_val = (register_1 & 4) << 1;
                    regs[register_1 & 3] = (regs[register_1 & 3] & ~(0xff << last_tlb_val)) | (((x) & 0xff) << last_tlb_val);
                    break Fd;
                case 0x8b://MOV Evqp Gvqp Move
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) | mem8_loc) & 3 ? __ld_32bits_mem8_read() : phys_mem32[(mem8_loc ^ last_tlb_val) >> 2]);
                    }
                    regs[(mem8 >> 3) & 7] = x;
                    break Fd;
                case 0xa0://MOV Ob AL Move
                    mem8_loc = Ub();
                    x = ld_8bits_mem8_read();
                    regs[0] = (regs[0] & -256) | x;
                    break Fd;
                case 0xa1://MOV Ovqp rAX Move
                    mem8_loc = Ub();
                    x = ld_32bits_mem8_read();
                    regs[0] = x;
                    break Fd;
                case 0xa2://MOV AL Ob Move
                    mem8_loc = Ub();
                    st8_mem8_write(regs[0]);
                    break Fd;
                case 0xa3://MOV rAX Ovqp Move
                    mem8_loc = Ub();
                    st32_mem8_write(regs[0]);
                    break Fd;
                case 0xd7://XLAT (DS:)[rBX+AL] AL Table Look-up Translation
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
                case 0xc6://MOV Ib Eb Move
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = phys_mem8[mem_ptr++];
                        set_either_two_bytes_of_reg_ABCD(mem8 & 7, x);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = phys_mem8[mem_ptr++];
                        st8_mem8_write(x);
                    }
                    break Fd;
                case 0xc7://MOV Ivds Evqp Move
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        regs[mem8 & 7] = x;
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        st32_mem8_write(x);
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
                case 0x86://XCHG  Gb Exchange Register/Memory with Register
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                        set_either_two_bytes_of_reg_ABCD(register_0, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_8bits_mem8_write();
                        st8_mem8_write((regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                    }
                    set_either_two_bytes_of_reg_ABCD(register_1, x);
                    break Fd;
                case 0x87://XCHG  Gvqp Exchange Register/Memory with Register
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = regs[register_0];
                        regs[register_0] = regs[register_1];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_write();
                        st32_mem8_write(regs[register_1]);
                    }
                    regs[register_1] = x;
                    break Fd;
                case 0x8e://MOV Ew Sw Move
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if (register_1 >= 6 || register_1 == 1)
                        blow_up_errcode0(6);
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7] & 0xffff;
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_16bits_mem8_read();
                    }
                    Ie(register_1, x);
                    break Fd;
                case 0x8c://MOV Sw Mw Move
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
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        st16_mem8_write(x);
                    }
                    break Fd;
                case 0xc4://LES Mp ES Load Far Pointer
                    Uf(0);
                    break Fd;
                case 0xc5://LDS Mp DS Load Far Pointer
                    Uf(3);
                    break Fd;
                case 0x00://ADD Gb Eb Add
                case 0x08://OR Gb Eb Logical Inclusive OR
                case 0x10://ADC Gb Eb Add with Carry
                case 0x18://SBB Gb Eb Integer Subtraction with Borrow
                case 0x20://AND Gb Eb Logical AND
                case 0x28://SUB Gb Eb Subtract
                case 0x30://XOR Gb Eb Logical Exclusive OR
                case 0x38://CMP Eb  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    y = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(conditional_var, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), y));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        if (conditional_var != 7) {
                            x = ld_8bits_mem8_write();
                            x = do_8bit_math(conditional_var, x, y);
                            st8_mem8_write(x);
                        } else {
                            x = ld_8bits_mem8_read();
                            do_8bit_math(7, x, y);
                        }
                    }
                    break Fd;
                case 0x01://ADD Gvqp Evqp Add
                    mem8 = phys_mem8[mem_ptr++];
                    y = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        {
                            _src = y;
                            _dst = regs[register_0] = (regs[register_0] + _src) >> 0;
                            _op = 2;
                        }
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_write();
                        {
                            _src = y;
                            _dst = x = (x + _src) >> 0;
                            _op = 2;
                        }
                        st32_mem8_write(x);
                    }
                    break Fd;
                case 0x09://OR Gvqp Evqp Logical Inclusive OR
                case 0x11://ADC Gvqp Evqp Add with Carry
                case 0x19://SBB Gvqp Evqp Integer Subtraction with Borrow
                case 0x21://AND Gvqp Evqp Logical AND
                case 0x29://SUB Gvqp Evqp Subtract
                case 0x31://XOR Gvqp Evqp Logical Exclusive OR
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    y = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = do_32bit_math(conditional_var, regs[register_0], y);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_write();
                        x = do_32bit_math(conditional_var, x, y);
                        st32_mem8_write(x);
                    }
                    break Fd;
                case 0x39://CMP Evqp  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    y = regs[(mem8 >> 3) & 7];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        {
                            _src = y;
                            _dst = (regs[register_0] - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_read();
                        {
                            _src = y;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    }
                    break Fd;
                case 0x02://ADD Eb Gb Add
                case 0x0a://OR Eb Gb Logical Inclusive OR
                case 0x12://ADC Eb Gb Add with Carry
                case 0x1a://SBB Eb Gb Integer Subtraction with Borrow
                case 0x22://AND Eb Gb Logical AND
                case 0x2a://SUB Eb Gb Subtract
                case 0x32://XOR Eb Gb Logical Exclusive OR
                case 0x3a://CMP Gb  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        y = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_8bits_mem8_read();
                    }
                    set_either_two_bytes_of_reg_ABCD(register_1, do_8bit_math(conditional_var, (regs[register_1 & 3] >> ((register_1 & 4) << 1)), y));
                    break Fd;
                case 0x03://ADD Evqp Gvqp Add
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_32bits_mem8_read();
                    }
                    {
                        _src = y;
                        _dst = regs[register_1] = (regs[register_1] + _src) >> 0;
                        _op = 2;
                    }
                    break Fd;
                case 0x0b://OR Evqp Gvqp Logical Inclusive OR
                case 0x13://ADC Evqp Gvqp Add with Carry
                case 0x1b://SBB Evqp Gvqp Integer Subtraction with Borrow
                case 0x23://AND Evqp Gvqp Logical AND
                case 0x2b://SUB Evqp Gvqp Subtract
                case 0x33://XOR Evqp Gvqp Logical Exclusive OR
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_32bits_mem8_read();
                    }
                    regs[register_1] = do_32bit_math(conditional_var, regs[register_1], y);
                    break Fd;
                case 0x3b://CMP Gvqp  Compare Two Operands
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_32bits_mem8_read();
                    }
                    {
                        _src = y;
                        _dst = (regs[register_1] - _src) >> 0;
                        _op = 8;
                    }
                    break Fd;
                case 0x04://ADD Ib AL Add
                case 0x0c://OR Ib AL Logical Inclusive OR
                case 0x14://ADC Ib AL Add with Carry
                case 0x1c://SBB Ib AL Integer Subtraction with Borrow
                case 0x24://AND Ib AL Logical AND
                case 0x2c://SUB Ib AL Subtract
                case 0x34://XOR Ib AL Logical Exclusive OR
                case 0x3c://CMP AL  Compare Two Operands
                    y = phys_mem8[mem_ptr++];
                    conditional_var = OPbyte >> 3;
                    set_either_two_bytes_of_reg_ABCD(0, do_8bit_math(conditional_var, regs[0] & 0xff, y));
                    break Fd;
                case 0x05://ADD Ivds rAX Add
                    {
                        y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _src = y;
                        _dst = regs[0] = (regs[0] + _src) >> 0;
                        _op = 2;
                    }
                    break Fd;
                case 0x0d://OR Ivds rAX Logical Inclusive OR
                case 0x15://ADC Ivds rAX Add with Carry
                case 0x1d://SBB Ivds rAX Integer Subtraction with Borrow
                case 0x25://AND Ivds rAX Logical AND
                case 0x2d://SUB Ivds rAX Subtract
                    {
                        y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    conditional_var = OPbyte >> 3;
                    regs[0] = do_32bit_math(conditional_var, regs[0], y);
                    break Fd;
                case 0x35://XOR Ivds rAX Logical Exclusive OR
                    {
                        y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _dst = regs[0] = regs[0] ^ y;
                        _op = 14;
                    }
                    break Fd;
                case 0x3d://CMP rAX  Compare Two Operands
                    {
                        y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _src = y;
                        _dst = (regs[0] - _src) >> 0;
                        _op = 8;
                    }
                    break Fd;
                case 0x80://ADD Ib Eb Add
                case 0x82://ADD Ib Eb Add
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        y = phys_mem8[mem_ptr++];
                        set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(conditional_var, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), y));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = phys_mem8[mem_ptr++];
                        if (conditional_var != 7) {
                            x = ld_8bits_mem8_write();
                            x = do_8bit_math(conditional_var, x, y);
                            st8_mem8_write(x);
                        } else {
                            x = ld_8bits_mem8_read();
                            do_8bit_math(7, x, y);
                        }
                    }
                    break Fd;
                case 0x81://ADD Ivds Evqp Add
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if (conditional_var == 7) {
                        if ((mem8 >> 6) == 3) {
                            x = regs[mem8 & 7];
                        } else {
                            mem8_loc = giant_get_mem8_loc_func(mem8);
                            x = ld_32bits_mem8_read();
                        }
                        {
                            y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                        {
                            _src = y;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        if ((mem8 >> 6) == 3) {
                            register_0 = mem8 & 7;
                            {
                                y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            regs[register_0] = do_32bit_math(conditional_var, regs[register_0], y);
                        } else {
                            mem8_loc = giant_get_mem8_loc_func(mem8);
                            {
                                y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            x = ld_32bits_mem8_write();
                            x = do_32bit_math(conditional_var, x, y);
                            st32_mem8_write(x);
                        }
                    }
                    break Fd;
                case 0x83://ADD Ibs Evqp Add
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if (conditional_var == 7) {
                        if ((mem8 >> 6) == 3) {
                            x = regs[mem8 & 7];
                        } else {
                            mem8_loc = giant_get_mem8_loc_func(mem8);
                            x = ld_32bits_mem8_read();
                        }
                        y = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        {
                            _src = y;
                            _dst = (x - _src) >> 0;
                            _op = 8;
                        }
                    } else {
                        if ((mem8 >> 6) == 3) {
                            register_0 = mem8 & 7;
                            y = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            regs[register_0] = do_32bit_math(conditional_var, regs[register_0], y);
                        } else {
                            mem8_loc = giant_get_mem8_loc_func(mem8);
                            y = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            x = ld_32bits_mem8_write();
                            x = do_32bit_math(conditional_var, x, y);
                            st32_mem8_write(x);
                        }
                    }
                    break Fd;
                case 0x40://INC  Zv Increment by 1
                case 0x41://REX.B   Extension of r/m field, base field, or opcode reg field
                case 0x42://REX.X   Extension of SIB index field
                case 0x43://REX.XB   REX.X and REX.B combination
                case 0x44://REX.R   Extension of ModR/M reg field
                case 0x45://REX.RB   REX.R and REX.B combination
                case 0x46://REX.RX   REX.R and REX.X combination
                case 0x47://REX.RXB   REX.R, REX.X and REX.B combination
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
                case 0x48://DEC  Zv Decrement by 1
                case 0x49://REX.WB   REX.W and REX.B combination
                case 0x4a://REX.WX   REX.W and REX.X combination
                case 0x4b://REX.WXB   REX.W, REX.X and REX.B combination
                case 0x4c://REX.WR   REX.W and REX.R combination
                case 0x4d://REX.WRB   REX.W, REX.R and REX.B combination
                case 0x4e://REX.WRX   REX.W, REX.R and REX.X combination
                case 0x4f://REX.WRXB   REX.W, REX.R, REX.X and REX.B combination
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
                case 0x6b://IMUL Evqp Gvqp Signed Multiply
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_32bits_mem8_read();
                    }
                    z = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    regs[register_1] = Wc(y, z);
                    break Fd;
                case 0x69://IMUL Evqp Gvqp Signed Multiply
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = ld_32bits_mem8_read();
                    }
                    {
                        z = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    regs[register_1] = Wc(y, z);
                    break Fd;
                case 0x84://TEST Eb  Logical Compare
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_8bits_mem8_read();
                    }
                    register_1 = (mem8 >> 3) & 7;
                    y = (regs[register_1 & 3] >> ((register_1 & 4) << 1));
                    {
                        _dst = (((x & y) << 24) >> 24);
                        _op = 12;
                    }
                    break Fd;
                case 0x85://TEST Evqp  Logical Compare
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = regs[mem8 & 7];
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_read();
                    }
                    y = regs[(mem8 >> 3) & 7];
                    {
                        _dst = x & y;
                        _op = 14;
                    }
                    break Fd;
                case 0xa8://TEST AL  Logical Compare
                    y = phys_mem8[mem_ptr++];
                    {
                        _dst = (((regs[0] & y) << 24) >> 24);
                        _op = 12;
                    }
                    break Fd;
                case 0xa9://TEST rAX  Logical Compare
                    {
                        y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    {
                        _dst = regs[0] & y;
                        _op = 14;
                    }
                    break Fd;
                case 0xf6://TEST Eb  Logical Compare
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    switch (conditional_var) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            y = phys_mem8[mem_ptr++];
                            {
                                _dst = (((x & y) << 24) >> 24);
                                _op = 12;
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, ~(regs[register_0 & 3] >> ((register_0 & 4) << 1)));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                x = ~x;
                                st8_mem8_write(x);
                            }
                            break;
                        case 3:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, do_8bit_math(5, 0, (regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                x = do_8bit_math(5, 0, x);
                                st8_mem8_write(x);
                            }
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(0, Oc(regs[0], x));
                            break;
                        case 5:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(0, Pc(regs[0], x));
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            Cc(x);
                            break;
                        case 7:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_read();
                            }
                            Ec(x);
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xf7://TEST Evqp  Logical Compare
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    switch (conditional_var) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            {
                                y = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            {
                                _dst = x & y;
                                _op = 14;
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = ~regs[register_0];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                x = ~x;
                                st32_mem8_write(x);
                            }
                            break;
                        case 3:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = do_32bit_math(5, 0, regs[register_0]);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                x = do_32bit_math(5, 0, x);
                                st32_mem8_write(x);
                            }
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Vc(regs[0], x);
                            regs[2] = v;
                            break;
                        case 5:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Wc(regs[0], x);
                            regs[2] = v;
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Hc(regs[2], regs[0], x);
                            regs[2] = v;
                            break;
                        case 7:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            regs[0] = Lc(regs[2], regs[0], x);
                            regs[2] = v;
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                //Rotate and Shift ops ---------------------------------------------------------------
                case 0xc0://ROL Ib Eb Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = phys_mem8[mem_ptr++];
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(conditional_var, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), y));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = phys_mem8[mem_ptr++];
                        x = ld_8bits_mem8_write();
                        x = shift8(conditional_var, x, y);
                        st8_mem8_write(x);
                    }
                    break Fd;
                case 0xc1://ROL Ib Evqp Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        y = phys_mem8[mem_ptr++];
                        register_0 = mem8 & 7;
                        regs[register_0] = shift32(conditional_var, regs[register_0], y);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        y = phys_mem8[mem_ptr++];
                        x = ld_32bits_mem8_write();
                        x = shift32(conditional_var, x, y);
                        st32_mem8_write(x);
                    }
                    break Fd;
                case 0xd0://ROL 1 Eb Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(conditional_var, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), 1));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_8bits_mem8_write();
                        x = shift8(conditional_var, x, 1);
                        st8_mem8_write(x);
                    }
                    break Fd;
                case 0xd1://ROL 1 Evqp Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = shift32(conditional_var, regs[register_0], 1);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_write();
                        x = shift32(conditional_var, x, 1);
                        st32_mem8_write(x);
                    }
                    break Fd;
                case 0xd2://ROL CL Eb Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    y = regs[1] & 0xff;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        set_either_two_bytes_of_reg_ABCD(register_0, shift8(conditional_var, (regs[register_0 & 3] >> ((register_0 & 4) << 1)), y));
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_8bits_mem8_write();
                        x = shift8(conditional_var, x, y);
                        st8_mem8_write(x);
                    }
                    break Fd;
                case 0xd3://ROL CL Evqp Rotate
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    y = regs[1] & 0xff;
                    if ((mem8 >> 6) == 3) {
                        register_0 = mem8 & 7;
                        regs[register_0] = shift32(conditional_var, regs[register_0], y);
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        x = ld_32bits_mem8_write();
                        x = shift32(conditional_var, x, y);
                        st32_mem8_write(x);
                    }
                    break Fd;
                case 0x98://CBW AL AX Convert Byte to Word
                    regs[0] = (regs[0] << 16) >> 16;
                    break Fd;
                case 0x99://CWD AX DX Convert Word to Doubleword
                    regs[2] = regs[0] >> 31;
                    break Fd;
                case 0x50://PUSH Zv SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
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
                                __st32_mem8_write(x);
                            } else {
                                phys_mem32[(mem8_loc ^ last_tlb_val) >> 2] = x;
                            }
                        }
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                case 0x58://POP SS:[rSP] Zv Pop a Value from the Stack
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

                case 0x60://PUSHA AX SS:[rSP] Push All General-Purpose Registers
                    Kf();
                    break Fd;
                case 0x61://POPA SS:[rSP] DI Pop All General-Purpose Registers
                    Mf();
                    break Fd;
                case 0x8f://POP SS:[rSP] Ev Pop a Value from the Stack
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3) {
                        x = Ad();
                        Bd();
                        regs[mem8 & 7] = x;
                    } else {
                        x = Ad();
                        y = regs[4];
                        Bd();
                        z = regs[4];
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                        regs[4] = y;
                        st32_mem8_write(x);
                        regs[4] = z;
                    }
                    break Fd;
                case 0x68://PUSH Ivs SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        st32_mem8_write(x);
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                case 0x6a://PUSH Ibss SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        st32_mem8_write(x);
                        regs[4] = mem8_loc;
                    } else {
                        xd(x);
                    }
                    break Fd;
                case 0xc8://ENTER Iw SS:[rSP] Make Stack Frame for Procedure Parameters
                    Tf();
                    break Fd;
                case 0xc9://LEAVE SS:[rSP] eBP High Level Procedure Exit
                    if (FS_usage_flag) {
                        mem8_loc = regs[5];
                        x = ld_32bits_mem8_read();
                        regs[5] = x;
                        regs[4] = (mem8_loc + 4) >> 0;
                    } else {
                        Of();
                    }
                    break Fd;
                case 0x9c://PUSHF Flags SS:[rSP] Push FLAGS Register onto the Stack
                    iopl = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && iopl != 3)
                        blow_up_errcode0(13);
                    x = id() & ~(0x00020000 | 0x00010000);
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        xd(x);
                    } else {
                        vd(x);
                    }
                    break Fd;
                case 0x9d://POPF SS:[rSP] Flags Pop Stack into FLAGS Register
                    iopl = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && iopl != 3)
                        blow_up_errcode0(13);
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        x = Ad();
                        Bd();
                        y = -1;
                    } else {
                        x = yd();
                        zd();
                        y = 0xffff;
                    }
                    z = (0x00000100 | 0x00040000 | 0x00200000 | 0x00004000);
                    if (cpu.cpl == 0) {
                        z |= 0x00000200 | 0x00003000;
                    } else {
                        if (cpu.cpl <= iopl)
                            z |= 0x00000200;
                    }
                    kd(x, z & y);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x06://PUSH ES SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                case 0x0e://PUSH CS SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                case 0x16://PUSH SS SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                case 0x1e://PUSH DS SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                    xd(cpu.segs[OPbyte >> 3].selector);
                    break Fd;
                case 0x07://POP SS:[rSP] ES Pop a Value from the Stack
                case 0x17://POP SS:[rSP] SS Pop a Value from the Stack
                case 0x1f://POP SS:[rSP] DS Pop a Value from the Stack
                    Ie(OPbyte >> 3, Ad() & 0xffff);
                    Bd();
                    break Fd;
                case 0x8d://LEA M Gvqp Load Effective Address
                    mem8 = phys_mem8[mem_ptr++];
                    if ((mem8 >> 6) == 3)
                        blow_up_errcode0(6);
                    CS_flags = (CS_flags & ~0x000f) | (6 + 1);
                    regs[(mem8 >> 3) & 7] = giant_get_mem8_loc_func(mem8);
                    break Fd;
                case 0xfe://INC  Eb Increment by 1
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    switch (conditional_var) {
                        case 0:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, increment_8bit((regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                x = increment_8bit(x);
                                st8_mem8_write(x);
                            }
                            break;
                        case 1:
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_either_two_bytes_of_reg_ABCD(register_0, decrement_8bit((regs[register_0 & 3] >> ((register_0 & 4) << 1))));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                x = decrement_8bit(x);
                                st8_mem8_write(x);
                            }
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xff://INC  Evqp Increment by 1
                    mem8 = phys_mem8[mem_ptr++];
                    conditional_var = (mem8 >> 3) & 7;
                    switch (conditional_var) {
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
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    x = _dst = (x + 1) >> 0;
                                    _op = 27;
                                }
                                st32_mem8_write(x);
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
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                {
                                    if (_op < 25) {
                                        _op2 = _op;
                                        _dst2 = _dst;
                                    }
                                    x = _dst = (x - 1) >> 0;
                                    _op = 30;
                                }
                                st32_mem8_write(x);
                            }
                            break;
                        case 2:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            y = (eip + mem_ptr - initial_mem_ptr);
                            if (FS_usage_flag) {
                                mem8_loc = (regs[4] - 4) >> 0;
                                st32_mem8_write(y);
                                regs[4] = mem8_loc;
                            } else {
                                xd(y);
                            }
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break;
                        case 4:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break;
                        case 6:
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            if (FS_usage_flag) {
                                mem8_loc = (regs[4] - 4) >> 0;
                                st32_mem8_write(x);
                                regs[4] = mem8_loc;
                            } else {
                                xd(x);
                            }
                            break;
                        case 3:
                        case 5:
                            if ((mem8 >> 6) == 3)
                                blow_up_errcode0(6);
                            mem8_loc = giant_get_mem8_loc_func(mem8);
                            x = ld_32bits_mem8_read();
                            mem8_loc = (mem8_loc + 4) >> 0;
                            y = ld_16bits_mem8_read();
                            if (conditional_var == 3)
                                Ze(1, y, x, (eip + mem_ptr - initial_mem_ptr));
                            else
                                Oe(y, x);
                            break;
                        default:
                            blow_up_errcode0(6);
                    }
                    break Fd;
                case 0xeb://JMP Jbs  Jump
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0xe9://JMP Jvds  Jump
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0xea://JMPF Ap  Jump
                    if ((((CS_flags >> 8) & 1) ^ 1)) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                    } else {
                        x = ld16_mem8_direct();
                    }
                    y = ld16_mem8_direct();
                    Oe(y, x);
                    break Fd;
                case 0x70://JO Jbs  Jump short if overflow (OF=1)
                    if (check_overflow()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x71://JNO Jbs  Jump short if not overflow (OF=0)
                    if (!check_overflow()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x72://JB Jbs  Jump short if below/not above or equal/carry (CF=1)
                    if (check_carry()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x73://JNB Jbs  Jump short if not below/above or equal/not carry (CF=0)
                    if (!check_carry()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x74://JZ Jbs  Jump short if zero/equal (ZF=0)
                    if ((_dst == 0)) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x75://JNZ Jbs  Jump short if not zero/not equal (ZF=1)
                    if (!(_dst == 0)) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x76://JBE Jbs  Jump short if below or equal/not above (CF=1 AND ZF=1)
                    if (ad()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x77://JNBE Jbs  Jump short if not below or equal/above (CF=0 AND ZF=0)
                    if (!ad()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x78://JS Jbs  Jump short if sign (SF=1)
                    if ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x79://JNS Jbs  Jump short if not sign (SF=0)
                    if (!(_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7a://JP Jbs  Jump short if parity/parity even (PF=1)
                    if (check_parity()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7b://JNP Jbs  Jump short if not parity/parity odd
                    if (!check_parity()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7c://JL Jbs  Jump short if less/not greater (SF!=OF)
                    if (cd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7d://JNL Jbs  Jump short if not less/greater or equal (SF=OF)
                    if (!cd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7e://JLE Jbs  Jump short if less or equal/not greater ((ZF=1) OR (SF!=OF))
                    if (dd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0x7f://JNLE Jbs  Jump short if not less nor equal/greater ((ZF=0) AND (SF=OF))
                    if (!dd()) {
                        x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                        mem_ptr = (mem_ptr + x) >> 0;
                    } else {
                        mem_ptr = (mem_ptr + 1) >> 0;
                    }
                    break Fd;
                case 0xe0://LOOPNZ Jbs eCX Decrement count; Jump short if count!=0 and ZF=0
                case 0xe1://LOOPZ Jbs eCX Decrement count; Jump short if count!=0 and ZF=1
                case 0xe2://LOOP Jbs eCX Decrement count; Jump short if count!=0
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (CS_flags & 0x0080)
                        conditional_var = 0xffff;
                    else
                        conditional_var = -1;
                    y = (regs[1] - 1) & conditional_var;
                    regs[1] = (regs[1] & ~conditional_var) | y;
                    OPbyte &= 3;
                    if (OPbyte == 0)
                        z = !(_dst == 0);
                    else if (OPbyte == 1)
                        z = (_dst == 0);
                    else
                        z = 1;
                    if (y && z) {
                        if (CS_flags & 0x0100) {
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                        } else {
                            mem_ptr = (mem_ptr + x) >> 0;
                        }
                    }
                    break Fd;
                case 0xe3://JCXZ Jbs  Jump short if eCX register is 0
                    x = ((phys_mem8[mem_ptr++] << 24) >> 24);
                    if (CS_flags & 0x0080)
                        conditional_var = 0xffff;
                    else
                        conditional_var = -1;
                    if ((regs[1] & conditional_var) == 0) {
                        if (CS_flags & 0x0100) {
                            eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                        } else {
                            mem_ptr = (mem_ptr + x) >> 0;
                        }
                    }
                    break Fd;
                case 0xc2://RETN SS:[rSP]  Return from procedure
                    y = (ld16_mem8_direct() << 16) >> 16;
                    x = Ad();
                    regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 4 + y) & SS_mask);
                    eip = x, mem_ptr = initial_mem_ptr = 0;
                    break Fd;
                case 0xc3://RETN SS:[rSP]  Return from procedure
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
                case 0xe8://CALL Jvds SS:[rSP] Call Procedure
                    {
                        x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                        mem_ptr += 4;
                    }
                    y = (eip + mem_ptr - initial_mem_ptr);
                    if (FS_usage_flag) {
                        mem8_loc = (regs[4] - 4) >> 0;
                        st32_mem8_write(y);
                        regs[4] = mem8_loc;
                    } else {
                        xd(y);
                    }
                    mem_ptr = (mem_ptr + x) >> 0;
                    break Fd;
                case 0x9a://CALLF Ap SS:[rSP] Call Procedure
                    z = (((CS_flags >> 8) & 1) ^ 1);
                    if (z) {
                        {
                            x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                            mem_ptr += 4;
                        }
                    } else {
                        x = ld16_mem8_direct();
                    }
                    y = ld16_mem8_direct();
                    Ze(z, y, x, (eip + mem_ptr - initial_mem_ptr));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xca://RETF Iw  Return from procedure
                    y = (ld16_mem8_direct() << 16) >> 16;
                    nf((((CS_flags >> 8) & 1) ^ 1), y);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xcb://RETF SS:[rSP]  Return from procedure
                    nf((((CS_flags >> 8) & 1) ^ 1), 0);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xcf://IRET SS:[rSP] Flags Interrupt Return
                    mf((((CS_flags >> 8) & 1) ^ 1));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x90://XCHG  Zvqp Exchange Register/Memory with Register
                    break Fd;
                case 0xcc://INT 3 SS:[rSP] Call to Interrupt Procedure
                    y = (eip + mem_ptr - initial_mem_ptr);
                    Ae(3, 1, 0, y, 0);
                    break Fd;
                case 0xcd://INT Ib SS:[rSP] Call to Interrupt Procedure
                    x = phys_mem8[mem_ptr++];
                    if ((cpu.eflags & 0x00020000) && ((cpu.eflags >> 12) & 3) != 3)
                        blow_up_errcode0(13);
                    y = (eip + mem_ptr - initial_mem_ptr);
                    Ae(x, 1, 0, y, 0);
                    break Fd;
                case 0xce://INTO eFlags SS:[rSP] Call to Interrupt Procedure
                    if (check_overflow()) {
                        y = (eip + mem_ptr - initial_mem_ptr);
                        Ae(4, 1, 0, y, 0);
                    }
                    break Fd;
                case 0x62://BOUND Gv SS:[rSP] Check Array Index Against Bounds
                    checkOp_BOUND();
                    break Fd;
                case 0xf5://CMC   Complement Carry Flag
                    _src = hd() ^ 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xf8://CLC   Clear Carry Flag
                    _src = hd() & ~0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xf9://STC   Set Carry Flag
                    _src = hd() | 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xfc://CLD   Clear Direction Flag
                    cpu.df = 1;
                    break Fd;
                case 0xfd://STD   Set Direction Flag
                    cpu.df = -1;
                    break Fd;
                case 0xfa://CLI   Clear Interrupt Flag
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    cpu.eflags &= ~0x00000200;
                    break Fd;
                case 0xfb://STI   Set Interrupt Flag
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    cpu.eflags |= 0x00000200;
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x9e://SAHF AH  Store AH into Flags
                    _src = ((regs[0] >> 8) & (0x0080 | 0x0040 | 0x0010 | 0x0004 | 0x0001)) | (check_overflow() << 11);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0x9f://LAHF  AH Load Status Flags into AH Register
                    x = id();
                    set_either_two_bytes_of_reg_ABCD(4, x);
                    break Fd;
                case 0xf4://HLT   Halt
                    if (cpu.cpl != 0)
                        blow_up_errcode0(13);
                    cpu.halted = 1;
                    exit_code = 257;
                    break Bg;
                case 0xa4://MOVS (DS:)[rSI] (ES:)[rDI] Move Data from String to String
                    stringOp_MOVSB();
                    break Fd;
                case 0xa5://MOVS DS:[SI] ES:[DI] Move Data from String to String
                    stringOp_MOVSD();
                    break Fd;
                case 0xaa://STOS AL (ES:)[rDI] Store String
                    stringOp_STOSB();
                    break Fd;
                case 0xab://STOS AX ES:[DI] Store String
                    stringOp_STOSD();
                    break Fd;
                case 0xa6://CMPS (ES:)[rDI]  Compare String Operands
                    stringOp_CMPSB();
                    break Fd;
                case 0xa7://CMPS ES:[DI]  Compare String Operands
                    stringOp_CMPSD();
                    break Fd;
                case 0xac://LODS (DS:)[rSI] AL Load String
                    stringOp_LODSB();
                    break Fd;
                case 0xad://LODS DS:[SI] AX Load String
                    stringOp_LODSD();
                    break Fd;
                case 0xae://SCAS (ES:)[rDI]  Scan String
                    stringOp_SCASB();
                    break Fd;
                case 0xaf://SCAS ES:[DI]  Scan String
                    stringOp_SCASD();
                    break Fd;
                case 0x6c://INS DX (ES:)[rDI] Input from Port to String
                    stringOp_INSB();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6d://INS DX ES:[DI] Input from Port to String
                    stringOp_INSD();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6e://OUTS (DS):[rSI] DX Output String to Port
                    stringOp_OUTSB();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x6f://OUTS DS:[SI] DX Output String to Port
                    stringOp_OUTSD();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xd8://FADD Msr ST Add
                case 0xd9://FLD ESsr ST Load Floating Point Value
                case 0xda://FIADD Mdi ST Add
                case 0xdb://FILD Mdi ST Load Integer
                case 0xdc://FADD Mdr ST Add
                case 0xdd://FLD Mdr ST Load Floating Point Value
                case 0xde://FIADD Mwi ST Add
                case 0xdf://FILD Mwi ST Load Integer
                    if (cpu.cr0 & ((1 << 2) | (1 << 3))) {
                        blow_up_errcode0(7);
                    }
                    mem8 = phys_mem8[mem_ptr++];
                    register_1 = (mem8 >> 3) & 7;
                    register_0 = mem8 & 7;
                    conditional_var = ((OPbyte & 7) << 3) | ((mem8 >> 3) & 7);
                    set_lower_two_bytes_of_register(0, 0xffff);
                    if ((mem8 >> 6) == 3) {
                    } else {
                        mem8_loc = giant_get_mem8_loc_func(mem8);
                    }
                    break Fd;
                case 0x9b://FWAIT   Check pending unmasked floating-point exceptions
                    break Fd;
                case 0xe4://IN Ib AL Input from Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    set_either_two_bytes_of_reg_ABCD(0, cpu.ld8_port(x));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe5://IN Ib eAX Input from Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    regs[0] = cpu.ld32_port(x);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe6://OUT AL Ib Output to Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    cpu.st8_port(x, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xe7://OUT eAX Ib Output to Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    x = phys_mem8[mem_ptr++];
                    cpu.st32_port(x, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xec://IN DX AL Input from Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    set_either_two_bytes_of_reg_ABCD(0, cpu.ld8_port(regs[2] & 0xffff));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xed://IN DX eAX Input from Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    regs[0] = cpu.ld32_port(regs[2] & 0xffff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xee://OUT AL DX Output to Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    cpu.st8_port(regs[2] & 0xffff, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0xef://OUT eAX DX Output to Port
                    iopl = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > iopl)
                        blow_up_errcode0(13);
                    cpu.st32_port(regs[2] & 0xffff, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    break Fd;
                case 0x27://DAA  AL Decimal Adjust AL after Addition
                    Df();
                    break Fd;
                case 0x2f://DAS  AL Decimal Adjust AL after Subtraction
                    Ff();
                    break Fd;
                case 0x37://AAA  AL ASCII Adjust After Addition
                    zf();
                    break Fd;
                case 0x3f://AAS  AL ASCII Adjust AL After Subtraction
                    Cf();
                    break Fd;
                case 0xd4://AAM  AL ASCII Adjust AX After Multiply
                    x = phys_mem8[mem_ptr++];
                    vf(x);
                    break Fd;
                case 0xd5://AAD  AL ASCII Adjust AX Before Division
                    x = phys_mem8[mem_ptr++];
                    yf(x);
                    break Fd;
                case 0x63://ARPL Ew  Adjust RPL Field of Segment Selector
                    tf();
                    break Fd;
                case 0xd6://SALC   Undefined and Reserved; Does not Generate #UD
                case 0xf1://INT1   Undefined and Reserved; Does not Generate #UD
                    blow_up_errcode0(6);
                    break;

                /*
                   TWO BYTE CODE INSTRUCTIONS BEGIN WITH 0F :  0F xx
                   =====================================================================================================
                */
                case 0x0f:
                    OPbyte = phys_mem8[mem_ptr++];
                    switch (OPbyte) {
                        case 0x80://JO Jvds  Jump short if overflow (OF=1)
                        case 0x81://JNO Jvds  Jump short if not overflow (OF=0)
                        case 0x82://JB Jvds  Jump short if below/not above or equal/carry (CF=1)
                        case 0x83://JNB Jvds  Jump short if not below/above or equal/not carry (CF=0)
                        case 0x84://JZ Jvds  Jump short if zero/equal (ZF=0)
                        case 0x85://JNZ Jvds  Jump short if not zero/not equal (ZF=1)
                        case 0x86://JBE Jvds  Jump short if below or equal/not above (CF=1 AND ZF=1)
                        case 0x87://JNBE Jvds  Jump short if not below or equal/above (CF=0 AND ZF=0)
                        case 0x88://JS Jvds  Jump short if sign (SF=1)
                        case 0x89://JNS Jvds  Jump short if not sign (SF=0)
                        case 0x8a://JP Jvds  Jump short if parity/parity even (PF=1)
                        case 0x8b://JNP Jvds  Jump short if not parity/parity odd
                        case 0x8c://JL Jvds  Jump short if less/not greater (SF!=OF)
                        case 0x8d://JNL Jvds  Jump short if not less/greater or equal (SF=OF)
                        case 0x8e://JLE Jvds  Jump short if less or equal/not greater ((ZF=1) OR (SF!=OF))
                        case 0x8f://JNLE Jvds  Jump short if not less nor equal/greater ((ZF=0) AND (SF=OF))
                            {
                                x = phys_mem8[mem_ptr] | (phys_mem8[mem_ptr + 1] << 8) | (phys_mem8[mem_ptr + 2] << 16) | (phys_mem8[mem_ptr + 3] << 24);
                                mem_ptr += 4;
                            }
                            if (check_status_bits_for_jump(OPbyte & 0xf))
                                mem_ptr = (mem_ptr + x) >> 0;
                            break Fd;
                        case 0x90://SETO  Eb Set Byte on Condition - overflow (OF=1)
                        case 0x91://SETNO  Eb Set Byte on Condition - not overflow (OF=0)
                        case 0x92://SETB  Eb Set Byte on Condition - below/not above or equal/carry (CF=1)
                        case 0x93://SETNB  Eb Set Byte on Condition - not below/above or equal/not carry (CF=0)
                        case 0x94://SETZ  Eb Set Byte on Condition - zero/equal (ZF=0)
                        case 0x95://SETNZ  Eb Set Byte on Condition - not zero/not equal (ZF=1)
                        case 0x96://SETBE  Eb Set Byte on Condition - below or equal/not above (CF=1 AND ZF=1)
                        case 0x97://SETNBE  Eb Set Byte on Condition - not below or equal/above (CF=0 AND ZF=0)
                        case 0x98://SETS  Eb Set Byte on Condition - sign (SF=1)
                        case 0x99://SETNS  Eb Set Byte on Condition - not sign (SF=0)
                        case 0x9a://SETP  Eb Set Byte on Condition - parity/parity even (PF=1)
                        case 0x9b://SETNP  Eb Set Byte on Condition - not parity/parity odd
                        case 0x9c://SETL  Eb Set Byte on Condition - less/not greater (SF!=OF)
                        case 0x9d://SETNL  Eb Set Byte on Condition - not less/greater or equal (SF=OF)
                        case 0x9e://SETLE  Eb Set Byte on Condition - less or equal/not greater ((ZF=1) OR (SF!=OF))
                        case 0x9f://SETNLE  Eb Set Byte on Condition - not less nor equal/greater ((ZF=0) AND (SF=OF))
                            mem8 = phys_mem8[mem_ptr++];
                            x = check_status_bits_for_jump(OPbyte & 0xf);
                            if ((mem8 >> 6) == 3) {
                                set_either_two_bytes_of_reg_ABCD(mem8 & 7, x);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                st8_mem8_write(x);
                            }
                            break Fd;
                        case 0x40://CMOVO Evqp Gvqp Conditional Move - overflow (OF=1)
                        case 0x41://CMOVNO Evqp Gvqp Conditional Move - not overflow (OF=0)
                        case 0x42://CMOVB Evqp Gvqp Conditional Move - below/not above or equal/carry (CF=1)
                        case 0x43://CMOVNB Evqp Gvqp Conditional Move - not below/above or equal/not carry (CF=0)
                        case 0x44://CMOVZ Evqp Gvqp Conditional Move - zero/equal (ZF=0)
                        case 0x45://CMOVNZ Evqp Gvqp Conditional Move - not zero/not equal (ZF=1)
                        case 0x46://CMOVBE Evqp Gvqp Conditional Move - below or equal/not above (CF=1 AND ZF=1)
                        case 0x47://CMOVNBE Evqp Gvqp Conditional Move - not below or equal/above (CF=0 AND ZF=0)
                        case 0x48://CMOVS Evqp Gvqp Conditional Move - sign (SF=1)
                        case 0x49://CMOVNS Evqp Gvqp Conditional Move - not sign (SF=0)
                        case 0x4a://CMOVP Evqp Gvqp Conditional Move - parity/parity even (PF=1)
                        case 0x4b://CMOVNP Evqp Gvqp Conditional Move - not parity/parity odd
                        case 0x4c://CMOVL Evqp Gvqp Conditional Move - less/not greater (SF!=OF)
                        case 0x4d://CMOVNL Evqp Gvqp Conditional Move - not less/greater or equal (SF=OF)
                        case 0x4e://CMOVLE Evqp Gvqp Conditional Move - less or equal/not greater ((ZF=1) OR (SF!=OF))
                        case 0x4f://CMOVNLE Evqp Gvqp Conditional Move - not less nor equal/greater ((ZF=0) AND (SF=OF))
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_read();
                            }
                            if (check_status_bits_for_jump(OPbyte & 0xf))
                                regs[(mem8 >> 3) & 7] = x;
                            break Fd;
                        case 0xb6://MOVZX Eb Gvqp Move with Zero-Extend
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1)) & 0xff;
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                            }
                            regs[register_1] = x;
                            break Fd;
                        case 0xb7://MOVZX Ew Gvqp Move with Zero-Extend
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7] & 0xffff;
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            regs[register_1] = x;
                            break Fd;
                        case 0xbe://MOVSX Eb Gvqp Move with Sign-Extension
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = (((last_tlb_val = _tlb_read_[mem8_loc >>> 12]) == -1) ? __ld_8bits_mem8_read() : phys_mem8[mem8_loc ^ last_tlb_val]);
                            }
                            regs[register_1] = (((x) << 24) >> 24);
                            break Fd;
                        case 0xbf://MOVSX Ew Gvqp Move with Sign-Extension
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            regs[register_1] = (((x) << 16) >> 16);
                            break Fd;
                        case 0x00://SLDT LDTR Mw Store Local Descriptor Table Register
                            if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
                                blow_up_errcode0(6);
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            switch (conditional_var) {
                                case 0:
                                case 1:
                                    if (conditional_var == 0)
                                        x = cpu.ldt.selector;
                                    else
                                        x = cpu.tr.selector;
                                    if ((mem8 >> 6) == 3) {
                                        set_lower_two_bytes_of_register(mem8 & 7, x);
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        st16_mem8_write(x);
                                    }
                                    break;
                                case 2:
                                case 3:
                                    if (cpu.cpl != 0)
                                        blow_up_errcode0(13);
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    if (conditional_var == 2)
                                        Ce(x);
                                    else
                                        Ee(x);
                                    break;
                                case 4:
                                case 5:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    sf(x, conditional_var & 1);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x01://SGDT GDTR Ms Store Global Descriptor Table Register
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            switch (conditional_var) {
                                case 2:
                                case 3:
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    if (this.cpl != 0)
                                        blow_up_errcode0(13);
                                    mem8_loc = giant_get_mem8_loc_func(mem8);
                                    x = ld_16bits_mem8_read();
                                    mem8_loc += 2;
                                    y = ld_32bits_mem8_read();
                                    if (conditional_var == 2) {
                                        this.gdt.base = y;
                                        this.gdt.limit = x;
                                    } else {
                                        this.idt.base = y;
                                        this.idt.limit = x;
                                    }
                                    break;
                                case 7:
                                    if (this.cpl != 0)
                                        blow_up_errcode0(13);
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    mem8_loc = giant_get_mem8_loc_func(mem8);
                                    cpu.tlb_flush_page(mem8_loc & -4096);
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0x02://LAR Mw Gvqp Load Access Rights Byte
                        case 0x03://LSL Mw Gvqp Load Segment Limit
                            qf((((CS_flags >> 8) & 1) ^ 1), OPbyte & 1);
                            break Fd;
                        case 0x20://MOV Cd Rd Move to/from Control Registers
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
                        case 0x22://MOV Rd Cd Move to/from Control Registers
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
                        case 0x06://CLTS  CR0 Clear Task-Switched Flag in CR0
                            if (cpu.cpl != 0)
                                blow_up_errcode0(13);
                            set_CR0(cpu.cr0 & ~(1 << 3)); //Clear Task-Switched Flag in CR0
                            break Fd;
                        case 0x23://MOV Rd Dd Move to/from Debug Registers
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
                        case 0xb2://LSS Mptp SS Load Far Pointer
                        case 0xb4://LFS Mptp FS Load Far Pointer
                        case 0xb5://LGS Mptp GS Load Far Pointer
                            Uf(OPbyte & 7);
                            break Fd;
                        case 0xa2://CPUID  IA32_BIOS_SIGN_ID CPU Identification
                            uf();
                            break Fd;
                        case 0xa4://SHLD Gvqp Evqp Double Precision Shift Left
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                z = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                regs[register_0] = rc(regs[register_0], y, z);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                z = phys_mem8[mem_ptr++];
                                x = ld_32bits_mem8_write();
                                x = rc(x, y, z);
                                st32_mem8_write(x);
                            }
                            break Fd;
                        case 0xa5://SHLD Gvqp Evqp Double Precision Shift Left
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            z = regs[1];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = rc(regs[register_0], y, z);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                x = rc(x, y, z);
                                st32_mem8_write(x);
                            }
                            break Fd;
                        case 0xac://SHRD Gvqp Evqp Double Precision Shift Right
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                z = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                regs[register_0] = sc(regs[register_0], y, z);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                z = phys_mem8[mem_ptr++];
                                x = ld_32bits_mem8_write();
                                x = sc(x, y, z);
                                st32_mem8_write(x);
                            }
                            break Fd;
                        case 0xad://SHRD Gvqp Evqp Double Precision Shift Right
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            z = regs[1];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = sc(regs[register_0], y, z);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                x = sc(x, y, z);
                                st32_mem8_write(x);
                            }
                            break Fd;
                        case 0xba://BT Evqp  Bit Test
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            switch (conditional_var) {
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                        y = phys_mem8[mem_ptr++];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        y = phys_mem8[mem_ptr++];
                                        x = ld_32bits_mem8_read();
                                    }
                                    uc(x, y);
                                    break;
                                case 5:
                                case 6:
                                case 7:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        y = phys_mem8[mem_ptr++];
                                        regs[register_0] = xc(conditional_var & 3, regs[register_0], y);
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        y = phys_mem8[mem_ptr++];
                                        x = ld_32bits_mem8_write();
                                        x = xc(conditional_var & 3, x, y);
                                        st32_mem8_write(x);
                                    }
                                    break;
                                default:
                                    blow_up_errcode0(6);
                            }
                            break Fd;
                        case 0xa3://BT Evqp  Bit Test
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                mem8_loc = (mem8_loc + ((y >> 5) << 2)) >> 0;
                                x = ld_32bits_mem8_read();
                            }
                            uc(x, y);
                            break Fd;
                        case 0xab://BTS Gvqp Evqp Bit Test and Set
                        case 0xb3://BTR Gvqp Evqp Bit Test and Reset
                        case 0xbb://BTC Gvqp Evqp Bit Test and Complement
                            mem8 = phys_mem8[mem_ptr++];
                            y = regs[(mem8 >> 3) & 7];
                            conditional_var = (OPbyte >> 3) & 3;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                regs[register_0] = xc(conditional_var, regs[register_0], y);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                mem8_loc = (mem8_loc + ((y >> 5) << 2)) >> 0;
                                x = ld_32bits_mem8_write();
                                x = xc(conditional_var, x, y);
                                st32_mem8_write(x);
                            }
                            break Fd;
                        case 0xbc://BSF Evqp Gvqp Bit Scan Forward
                        case 0xbd://BSR Evqp Gvqp Bit Scan Reverse
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld_32bits_mem8_read();
                            }
                            if (OPbyte & 1)
                                regs[register_1] = Bc(regs[register_1], y);
                            else
                                regs[register_1] = zc(regs[register_1], y);
                            break Fd;
                        case 0xaf://IMUL Evqp Gvqp Signed Multiply
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld_32bits_mem8_read();
                            }
                            regs[register_1] = Wc(regs[register_1], y);
                            break Fd;
                        case 0x31://RDTSC IA32_TIME_STAMP_COUNTER EAX Read Time-Stamp Counter
                            if ((cpu.cr4 & (1 << 2)) && cpu.cpl != 0)
                                blow_up_errcode0(13);
                            x = current_cycle_count();
                            regs[0] = x >>> 0;
                            regs[2] = (x / 0x100000000) >>> 0;
                            break Fd;
                        case 0xc0://XADD  Eb Exchange and Add
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                                y = do_8bit_math(0, x, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                set_either_two_bytes_of_reg_ABCD(register_1, x);
                                set_either_two_bytes_of_reg_ABCD(register_0, y);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                y = do_8bit_math(0, x, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                st8_mem8_write(y);
                                set_either_two_bytes_of_reg_ABCD(register_1, x);
                            }
                            break Fd;
                        case 0xc1://XADD  Evqp Exchange and Add
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = regs[register_0];
                                y = do_32bit_math(0, x, regs[register_1]);
                                regs[register_1] = x;
                                regs[register_0] = y;
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                y = do_32bit_math(0, x, regs[register_1]);
                                st32_mem8_write(y);
                                regs[register_1] = x;
                            }
                            break Fd;
                        case 0xb0://CMPXCHG Gb Eb Compare and Exchange
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = (regs[register_0 & 3] >> ((register_0 & 4) << 1));
                                y = do_8bit_math(5, regs[0], x);
                                if (y == 0) {
                                    set_either_two_bytes_of_reg_ABCD(register_0, (regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                } else {
                                    set_either_two_bytes_of_reg_ABCD(0, x);
                                }
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_8bits_mem8_write();
                                y = do_8bit_math(5, regs[0], x);
                                if (y == 0) {
                                    st8_mem8_write((regs[register_1 & 3] >> ((register_1 & 4) << 1)));
                                } else {
                                    set_either_two_bytes_of_reg_ABCD(0, x);
                                }
                            }
                            break Fd;
                        case 0xb1://CMPXCHG Gvqp Evqp Compare and Exchange
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                x = regs[register_0];
                                y = do_32bit_math(5, regs[0], x);
                                if (y == 0) {
                                    regs[register_0] = regs[register_1];
                                } else {
                                    regs[0] = x;
                                }
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_32bits_mem8_write();
                                y = do_32bit_math(5, regs[0], x);
                                if (y == 0) {
                                    st32_mem8_write(regs[register_1]);
                                } else {
                                    regs[0] = x;
                                }
                            }
                            break Fd;
                        case 0xa0://PUSH FS SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                        case 0xa8://PUSH GS SS:[rSP] Push Word, Doubleword or Quadword Onto the Stack
                            xd(cpu.segs[(OPbyte >> 3) & 7].selector);
                            break Fd;
                        case 0xa1://POP SS:[rSP] FS Pop a Value from the Stack
                        case 0xa9://POP SS:[rSP] GS Pop a Value from the Stack
                            Ie((OPbyte >> 3) & 7, Ad() & 0xffff);
                            Bd();
                            break Fd;
                        case 0xc8://BSWAP  Zvqp Byte Swap
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
                        case 0x05://LOADALL  AX Load All of the CPU Registers
                        case 0x07://LOADALL  EAX Load All of the CPU Registers
                        case 0x08://INVD   Invalidate Internal Caches
                        case 0x09://WBINVD   Write Back and Invalidate Cache
                        case 0x0a:
                        case 0x0b://UD2   Undefined Instruction
                        case 0x0c:
                        case 0x0d://NOP Ev  No Operation
                        case 0x0e:
                        case 0x0f:
                        case 0x10://MOVUPS Wps Vps Move Unaligned Packed Single-FP Values
                        case 0x11://MOVUPS Vps Wps Move Unaligned Packed Single-FP Values
                        case 0x12://MOVHLPS Uq Vq Move Packed Single-FP Values High to Low
                        case 0x13://MOVLPS Vq Mq Move Low Packed Single-FP Values
                        case 0x14://UNPCKLPS Wq Vps Unpack and Interleave Low Packed Single-FP Values
                        case 0x15://UNPCKHPS Wq Vps Unpack and Interleave High Packed Single-FP Values
                        case 0x16://MOVLHPS Uq Vq Move Packed Single-FP Values Low to High
                        case 0x17://MOVHPS Vq Mq Move High Packed Single-FP Values
                        case 0x18://HINT_NOP Ev  Hintable NOP
                        case 0x19://HINT_NOP Ev  Hintable NOP
                        case 0x1a://HINT_NOP Ev  Hintable NOP
                        case 0x1b://HINT_NOP Ev  Hintable NOP
                        case 0x1c://HINT_NOP Ev  Hintable NOP
                        case 0x1d://HINT_NOP Ev  Hintable NOP
                        case 0x1e://HINT_NOP Ev  Hintable NOP
                        case 0x1f://HINT_NOP Ev  Hintable NOP
                        case 0x21://MOV Dd Rd Move to/from Debug Registers
                        case 0x24://MOV Td Rd Move to/from Test Registers
                        case 0x25:
                        case 0x26://MOV Rd Td Move to/from Test Registers
                        case 0x27:
                        case 0x28://MOVAPS Wps Vps Move Aligned Packed Single-FP Values
                        case 0x29://MOVAPS Vps Wps Move Aligned Packed Single-FP Values
                        case 0x2a://CVTPI2PS Qpi Vps Convert Packed DW Integers to1.11 PackedSingle-FP Values
                        case 0x2b://MOVNTPS Vps Mps Store Packed Single-FP Values Using Non-Temporal Hint
                        case 0x2c://CVTTPS2PI Wpsq Ppi Convert with Trunc. Packed Single-FP Values to1.11 PackedDW Integers
                        case 0x2d://CVTPS2PI Wpsq Ppi Convert Packed Single-FP Values to1.11 PackedDW Integers
                        case 0x2e://UCOMISS Vss  Unordered Compare Scalar Single-FP Values and Set EFLAGS
                        case 0x2f://COMISS Vss  Compare Scalar Ordered Single-FP Values and Set EFLAGS
                        case 0x30://WRMSR rCX MSR Write to Model Specific Register
                        case 0x32://RDMSR rCX rAX Read from Model Specific Register
                        case 0x33://RDPMC PMC EAX Read Performance-Monitoring Counters
                        case 0x34://SYSENTER IA32_SYSENTER_CS SS Fast System Call
                        case 0x35://SYSEXIT IA32_SYSENTER_CS SS Fast Return from Fast System Call
                        case 0x36:
                        case 0x37://GETSEC EAX  GETSEC Leaf Functions
                        case 0x38://PSHUFB Qq Pq Packed Shuffle Bytes
                        case 0x39:
                        case 0x3a://ROUNDPS Wps Vps Round Packed Single-FP Values
                        case 0x3b:
                        case 0x3c:
                        case 0x3d:
                        case 0x3e:
                        case 0x3f:
                        case 0x50://MOVMSKPS Ups Gdqp Extract Packed Single-FP Sign Mask
                        case 0x51://SQRTPS Wps Vps Compute Square Roots of Packed Single-FP Values
                        case 0x52://RSQRTPS Wps Vps Compute Recipr. of Square Roots of Packed Single-FP Values
                        case 0x53://RCPPS Wps Vps Compute Reciprocals of Packed Single-FP Values
                        case 0x54://ANDPS Wps Vps Bitwise Logical AND of Packed Single-FP Values
                        case 0x55://ANDNPS Wps Vps Bitwise Logical AND NOT of Packed Single-FP Values
                        case 0x56://ORPS Wps Vps Bitwise Logical OR of Single-FP Values
                        case 0x57://XORPS Wps Vps Bitwise Logical XOR for Single-FP Values
                        case 0x58://ADDPS Wps Vps Add Packed Single-FP Values
                        case 0x59://MULPS Wps Vps Multiply Packed Single-FP Values
                        case 0x5a://CVTPS2PD Wps Vpd Convert Packed Single-FP Values to1.11 PackedDouble-FP Values
                        case 0x5b://CVTDQ2PS Wdq Vps Convert Packed DW Integers to1.11 PackedSingle-FP Values
                        case 0x5c://SUBPS Wps Vps Subtract Packed Single-FP Values
                        case 0x5d://MINPS Wps Vps Return Minimum Packed Single-FP Values
                        case 0x5e://DIVPS Wps Vps Divide Packed Single-FP Values
                        case 0x5f://MAXPS Wps Vps Return Maximum Packed Single-FP Values
                        case 0x60://PUNPCKLBW Qd Pq Unpack Low Data
                        case 0x61://PUNPCKLWD Qd Pq Unpack Low Data
                        case 0x62://PUNPCKLDQ Qd Pq Unpack Low Data
                        case 0x63://PACKSSWB Qd Pq Pack with Signed Saturation
                        case 0x64://PCMPGTB Qd Pq Compare Packed Signed Integers for Greater Than
                        case 0x65://PCMPGTW Qd Pq Compare Packed Signed Integers for Greater Than
                        case 0x66://PCMPGTD Qd Pq Compare Packed Signed Integers for Greater Than
                        case 0x67://PACKUSWB Qq Pq Pack with Unsigned Saturation
                        case 0x68://PUNPCKHBW Qq Pq Unpack High Data
                        case 0x69://PUNPCKHWD Qq Pq Unpack High Data
                        case 0x6a://PUNPCKHDQ Qq Pq Unpack High Data
                        case 0x6b://PACKSSDW Qq Pq Pack with Signed Saturation
                        case 0x6c://PUNPCKLQDQ Wdq Vdq Unpack Low Data
                        case 0x6d://PUNPCKHQDQ Wdq Vdq Unpack High Data
                        case 0x6e://MOVD Ed Pq Move Doubleword
                        case 0x6f://MOVQ Qq Pq Move Quadword
                        case 0x70://PSHUFW Qq Pq Shuffle Packed Words
                        case 0x71://PSRLW Ib Nq Shift Packed Data Right Logical
                        case 0x72://PSRLD Ib Nq Shift Double Quadword Right Logical
                        case 0x73://PSRLQ Ib Nq Shift Packed Data Right Logical
                        case 0x74://PCMPEQB Qq Pq Compare Packed Data for Equal
                        case 0x75://PCMPEQW Qq Pq Compare Packed Data for Equal
                        case 0x76://PCMPEQD Qq Pq Compare Packed Data for Equal
                        case 0x77://EMMS   Empty MMX Technology State
                        case 0x78://VMREAD Gd Ed Read Field from Virtual-Machine Control Structure
                        case 0x79://VMWRITE Gd  Write Field to Virtual-Machine Control Structure
                        case 0x7a:
                        case 0x7b:
                        case 0x7c://HADDPD Wpd Vpd Packed Double-FP Horizontal Add
                        case 0x7d://HSUBPD Wpd Vpd Packed Double-FP Horizontal Subtract
                        case 0x7e://MOVD Pq Ed Move Doubleword
                        case 0x7f://MOVQ Pq Qq Move Quadword
                        case 0xa6:
                        case 0xa7:
                        case 0xaa://RSM  Flags Resume from System Management Mode
                        case 0xae://FXSAVE ST Mstx Save x87 FPU, MMX, XMM, and MXCSR State
                        case 0xb8://JMPE   Jump to IA-64 Instruction Set
                        case 0xb9://UD G  Undefined Instruction
                        case 0xc2://CMPPS Wps Vps Compare Packed Single-FP Values
                        case 0xc3://MOVNTI Gdqp Mdqp Store Doubleword Using Non-Temporal Hint
                        case 0xc4://PINSRW Rdqp Pq Insert Word
                        case 0xc5://PEXTRW Nq Gdqp Extract Word
                        case 0xc6://SHUFPS Wps Vps Shuffle Packed Single-FP Values
                        case 0xc7://CMPXCHG8B EBX Mq Compare and Exchange Bytes
                        case 0xd0://ADDSUBPD Wpd Vpd Packed Double-FP Add/Subtract
                        case 0xd1://PSRLW Qq Pq Shift Packed Data Right Logical
                        case 0xd2://PSRLD Qq Pq Shift Packed Data Right Logical
                        case 0xd3://PSRLQ Qq Pq Shift Packed Data Right Logical
                        case 0xd4://PADDQ Qq Pq Add Packed Quadword Integers
                        case 0xd5://PMULLW Qq Pq Multiply Packed Signed Integers and Store Low Result
                        case 0xd6://MOVQ Vq Wq Move Quadword
                        case 0xd7://PMOVMSKB Nq Gdqp Move Byte Mask
                        case 0xd8://PSUBUSB Qq Pq Subtract Packed Unsigned Integers with Unsigned Saturation
                        case 0xd9://PSUBUSW Qq Pq Subtract Packed Unsigned Integers with Unsigned Saturation
                        case 0xda://PMINUB Qq Pq Minimum of Packed Unsigned Byte Integers
                        case 0xdb://PAND Qd Pq Logical AND
                        case 0xdc://PADDUSB Qq Pq Add Packed Unsigned Integers with Unsigned Saturation
                        case 0xdd://PADDUSW Qq Pq Add Packed Unsigned Integers with Unsigned Saturation
                        case 0xde://PMAXUB Qq Pq Maximum of Packed Unsigned Byte Integers
                        case 0xdf://PANDN Qq Pq Logical AND NOT
                        case 0xe0://PAVGB Qq Pq Average Packed Integers
                        case 0xe1://PSRAW Qq Pq Shift Packed Data Right Arithmetic
                        case 0xe2://PSRAD Qq Pq Shift Packed Data Right Arithmetic
                        case 0xe3://PAVGW Qq Pq Average Packed Integers
                        case 0xe4://PMULHUW Qq Pq Multiply Packed Unsigned Integers and Store High Result
                        case 0xe5://PMULHW Qq Pq Multiply Packed Signed Integers and Store High Result
                        case 0xe6://CVTPD2DQ Wpd Vdq Convert Packed Double-FP Values to1.11 PackedDW Integers
                        case 0xe7://MOVNTQ Pq Mq Store of Quadword Using Non-Temporal Hint
                        case 0xe8://PSUBSB Qq Pq Subtract Packed Signed Integers with Signed Saturation
                        case 0xe9://PSUBSW Qq Pq Subtract Packed Signed Integers with Signed Saturation
                        case 0xea://PMINSW Qq Pq Minimum of Packed Signed Word Integers
                        case 0xeb://POR Qq Pq Bitwise Logical OR
                        case 0xec://PADDSB Qq Pq Add Packed Signed Integers with Signed Saturation
                        case 0xed://PADDSW Qq Pq Add Packed Signed Integers with Signed Saturation
                        case 0xee://PMAXSW Qq Pq Maximum of Packed Signed Word Integers
                        case 0xef://PXOR Qq Pq Logical Exclusive OR
                        case 0xf0://LDDQU Mdq Vdq Load Unaligned Integer 128 Bits
                        case 0xf1://PSLLW Qq Pq Shift Packed Data Left Logical
                        case 0xf2://PSLLD Qq Pq Shift Packed Data Left Logical
                        case 0xf3://PSLLQ Qq Pq Shift Packed Data Left Logical
                        case 0xf4://PMULUDQ Qq Pq Multiply Packed Unsigned DW Integers
                        case 0xf5://PMADDWD Qd Pq Multiply and Add Packed Integers
                        case 0xf6://PSADBW Qq Pq Compute Sum of Absolute Differences
                        case 0xf7://MASKMOVQ Nq (DS:)[rDI] Store Selected Bytes of Quadword
                        case 0xf8://PSUBB Qq Pq Subtract Packed Integers
                        case 0xf9://PSUBW Qq Pq Subtract Packed Integers
                        case 0xfa://PSUBD Qq Pq Subtract Packed Integers
                        case 0xfb://PSUBQ Qq Pq Subtract Packed Quadword Integers
                        case 0xfc://PADDB Qq Pq Add Packed Integers
                        case 0xfd://PADDW Qq Pq Add Packed Integers
                        case 0xfe://PADDD Qq Pq Add Packed Integers
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
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                st16_mem8_write(x);
                            }
                            break Fd;
                        case 0x18b:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
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
                            set_lower_two_bytes_of_register(OPbyte & 7, ld16_mem8_direct());
                            break Fd;
                        case 0x1a1:
                            mem8_loc = Ub();
                            x = ld_16bits_mem8_read();
                            set_lower_two_bytes_of_register(0, x);
                            break Fd;
                        case 0x1a3:
                            mem8_loc = Ub();
                            st16_mem8_write(regs[0]);
                            break Fd;
                        case 0x1c7:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = ld16_mem8_direct();
                                set_lower_two_bytes_of_register(mem8 & 7, x);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld16_mem8_direct();
                                st16_mem8_write(x);
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
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_write();
                                st16_mem8_write(regs[register_1]);
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
                            conditional_var = (OPbyte >> 3) & 7;
                            y = regs[(mem8 >> 3) & 7];
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, do_16bit_math(conditional_var, regs[register_0], y));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                if (conditional_var != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(conditional_var, x, y);
                                    st16_mem8_write(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, y);
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
                            conditional_var = (OPbyte >> 3) & 7;
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld_16bits_mem8_read();
                            }
                            set_lower_two_bytes_of_register(register_1, do_16bit_math(conditional_var, regs[register_1], y));
                            break Fd;
                        case 0x105:
                        case 0x10d:
                        case 0x115:
                        case 0x11d:
                        case 0x125:
                        case 0x12d:
                        case 0x135:
                        case 0x13d:
                            y = ld16_mem8_direct();
                            conditional_var = (OPbyte >> 3) & 7;
                            set_lower_two_bytes_of_register(0, do_16bit_math(conditional_var, regs[0], y));
                            break Fd;
                        case 0x181:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                y = ld16_mem8_direct();
                                regs[register_0] = do_16bit_math(conditional_var, regs[register_0], y);
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld16_mem8_direct();
                                if (conditional_var != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(conditional_var, x, y);
                                    st16_mem8_write(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, y);
                                }
                            }
                            break Fd;
                        case 0x183:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                y = ((phys_mem8[mem_ptr++] << 24) >> 24);
                                set_lower_two_bytes_of_register(register_0, do_16bit_math(conditional_var, regs[register_0], y));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ((phys_mem8[mem_ptr++] << 24) >> 24);
                                if (conditional_var != 7) {
                                    x = ld_16bits_mem8_write();
                                    x = do_16bit_math(conditional_var, x, y);
                                    st16_mem8_write(x);
                                } else {
                                    x = ld_16bits_mem8_read();
                                    do_16bit_math(7, x, y);
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
                            set_lower_two_bytes_of_register(register_1, increment_16bit(regs[register_1]));
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
                            set_lower_two_bytes_of_register(register_1, decrement_16bit(regs[register_1]));
                            break Fd;
                        case 0x16b:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld_16bits_mem8_read();
                            }
                            z = ((phys_mem8[mem_ptr++] << 24) >> 24);
                            set_lower_two_bytes_of_register(register_1, Rc(y, z));
                            break Fd;
                        case 0x169:
                            mem8 = phys_mem8[mem_ptr++];
                            register_1 = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = ld_16bits_mem8_read();
                            }
                            z = ld16_mem8_direct();
                            set_lower_two_bytes_of_register(register_1, Rc(y, z));
                            break Fd;
                        case 0x185:
                            mem8 = phys_mem8[mem_ptr++];
                            if ((mem8 >> 6) == 3) {
                                x = regs[mem8 & 7];
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_read();
                            }
                            y = regs[(mem8 >> 3) & 7];
                            {
                                _dst = (((x & y) << 16) >> 16);
                                _op = 13;
                            }
                            break Fd;
                        case 0x1a9:
                            y = ld16_mem8_direct();
                            {
                                _dst = (((regs[0] & y) << 16) >> 16);
                                _op = 13;
                            }
                            break Fd;
                        case 0x1f7:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            switch (conditional_var) {
                                case 0:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    y = ld16_mem8_direct();
                                    {
                                        _dst = (((x & y) << 16) >> 16);
                                        _op = 13;
                                    }
                                    break;
                                case 2:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, ~regs[register_0]);
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = ~x;
                                        st16_mem8_write(x);
                                    }
                                    break;
                                case 3:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, do_16bit_math(5, 0, regs[register_0]));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = do_16bit_math(5, 0, x);
                                        st16_mem8_write(x);
                                    }
                                    break;
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
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
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
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
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    Fc(x);
                                    break;
                                case 7:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
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
                            conditional_var = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                y = phys_mem8[mem_ptr++];
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(conditional_var, regs[register_0], y));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                y = phys_mem8[mem_ptr++];
                                x = ld_16bits_mem8_write();
                                x = shift16(conditional_var, x, y);
                                st16_mem8_write(x);
                            }
                            break Fd;
                        case 0x1d1:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(conditional_var, regs[register_0], 1));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_write();
                                x = shift16(conditional_var, x, 1);
                                st16_mem8_write(x);
                            }
                            break Fd;
                        case 0x1d3:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            y = regs[1] & 0xff;
                            if ((mem8 >> 6) == 3) {
                                register_0 = mem8 & 7;
                                set_lower_two_bytes_of_register(register_0, shift16(conditional_var, regs[register_0], y));
                            } else {
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                x = ld_16bits_mem8_write();
                                x = shift16(conditional_var, x, y);
                                st16_mem8_write(x);
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
                                y = regs[4];
                                zd();
                                z = regs[4];
                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                regs[4] = y;
                                st16_mem8_write(x);
                                regs[4] = z;
                            }
                            break Fd;
                        case 0x168:
                            x = ld16_mem8_direct();
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
                            set_lower_two_bytes_of_register((mem8 >> 3) & 7, giant_get_mem8_loc_func(mem8));
                            break Fd;
                        case 0x1ff:
                            mem8 = phys_mem8[mem_ptr++];
                            conditional_var = (mem8 >> 3) & 7;
                            switch (conditional_var) {
                                case 0:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, increment_16bit(regs[register_0]));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = increment_16bit(x);
                                        st16_mem8_write(x);
                                    }
                                    break;
                                case 1:
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, decrement_16bit(regs[register_0]));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = decrement_16bit(x);
                                        st16_mem8_write(x);
                                    }
                                    break;
                                case 2:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    vd((eip + mem_ptr - initial_mem_ptr));
                                    eip = x, mem_ptr = initial_mem_ptr = 0;
                                    break;
                                case 4:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7] & 0xffff;
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    eip = x, mem_ptr = initial_mem_ptr = 0;
                                    break;
                                case 6:
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_read();
                                    }
                                    vd(x);
                                    break;
                                case 3:
                                case 5:
                                    if ((mem8 >> 6) == 3)
                                        blow_up_errcode0(6);
                                    mem8_loc = giant_get_mem8_loc_func(mem8);
                                    x = ld_16bits_mem8_read();
                                    mem8_loc = (mem8_loc + 2) >> 0;
                                    y = ld_16bits_mem8_read();
                                    if (conditional_var == 3)
                                        Ze(0, y, x, (eip + mem_ptr - initial_mem_ptr));
                                    else
                                        Oe(y, x);
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
                            x = ld16_mem8_direct();
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
                            y = check_status_bits_for_jump(OPbyte & 0xf);
                            if (y)
                                eip = (eip + mem_ptr - initial_mem_ptr + x) & 0xffff, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1c2:
                            y = (ld16_mem8_direct() << 16) >> 16;
                            x = yd();
                            regs[4] = (regs[4] & ~SS_mask) | ((regs[4] + 2 + y) & SS_mask);
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1c3:
                            x = yd();
                            zd();
                            eip = x, mem_ptr = initial_mem_ptr = 0;
                            break Fd;
                        case 0x1e8:
                            x = ld16_mem8_direct();
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
                            iopl = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > iopl)
                                blow_up_errcode0(13);
                            x = phys_mem8[mem_ptr++];
                            set_lower_two_bytes_of_register(0, cpu.ld16_port(x));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1e7:
                            iopl = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > iopl)
                                blow_up_errcode0(13);
                            x = phys_mem8[mem_ptr++];
                            cpu.st16_port(x, regs[0] & 0xffff);
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1ed:
                            iopl = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > iopl)
                                blow_up_errcode0(13);
                            set_lower_two_bytes_of_register(0, cpu.ld16_port(regs[2] & 0xffff));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            break Fd;
                        case 0x1ef:
                            iopl = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > iopl)
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
                                    x = ld16_mem8_direct();
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
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
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
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
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
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_8bits_mem8_read();
                                    }
                                    set_lower_two_bytes_of_register(register_1, (((x) << 24) >> 24));
                                    break Fd;
                                case 0x1af:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        y = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        y = ld_16bits_mem8_read();
                                    }
                                    set_lower_two_bytes_of_register(register_1, Rc(regs[register_1], y));
                                    break Fd;
                                case 0x1c1:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = regs[register_0];
                                        y = do_16bit_math(0, x, regs[register_1]);
                                        set_lower_two_bytes_of_register(register_1, x);
                                        set_lower_two_bytes_of_register(register_0, y);
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        y = do_16bit_math(0, x, regs[register_1]);
                                        st16_mem8_write(y);
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
                                    y = regs[(mem8 >> 3) & 7];
                                    conditional_var = (OPbyte >> 3) & 1;
                                    if ((mem8 >> 6) == 3) {
                                        z = phys_mem8[mem_ptr++];
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, oc(conditional_var, regs[register_0], y, z));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        z = phys_mem8[mem_ptr++];
                                        x = ld_16bits_mem8_write();
                                        x = oc(conditional_var, x, y, z);
                                        st16_mem8_write(x);
                                    }
                                    break Fd;
                                case 0x1a5:
                                case 0x1ad:
                                    mem8 = phys_mem8[mem_ptr++];
                                    y = regs[(mem8 >> 3) & 7];
                                    z = regs[1];
                                    conditional_var = (OPbyte >> 3) & 1;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, oc(conditional_var, regs[register_0], y, z));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        x = oc(conditional_var, x, y, z);
                                        st16_mem8_write(x);
                                    }
                                    break Fd;
                                case 0x1ba:
                                    mem8 = phys_mem8[mem_ptr++];
                                    conditional_var = (mem8 >> 3) & 7;
                                    switch (conditional_var) {
                                        case 4:
                                            if ((mem8 >> 6) == 3) {
                                                x = regs[mem8 & 7];
                                                y = phys_mem8[mem_ptr++];
                                            } else {
                                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                                y = phys_mem8[mem_ptr++];
                                                x = ld_16bits_mem8_read();
                                            }
                                            tc(x, y);
                                            break;
                                        case 5:
                                        case 6:
                                        case 7:
                                            if ((mem8 >> 6) == 3) {
                                                register_0 = mem8 & 7;
                                                y = phys_mem8[mem_ptr++];
                                                regs[register_0] = vc(conditional_var & 3, regs[register_0], y);
                                            } else {
                                                mem8_loc = giant_get_mem8_loc_func(mem8);
                                                y = phys_mem8[mem_ptr++];
                                                x = ld_16bits_mem8_write();
                                                x = vc(conditional_var & 3, x, y);
                                                st16_mem8_write(x);
                                            }
                                            break;
                                        default:
                                            blow_up_errcode0(6);
                                    }
                                    break Fd;
                                case 0x1a3:
                                    mem8 = phys_mem8[mem_ptr++];
                                    y = regs[(mem8 >> 3) & 7];
                                    if ((mem8 >> 6) == 3) {
                                        x = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        mem8_loc = (mem8_loc + (((y & 0xffff) >> 4) << 1)) >> 0;
                                        x = ld_16bits_mem8_read();
                                    }
                                    tc(x, y);
                                    break Fd;
                                case 0x1ab:
                                case 0x1b3:
                                case 0x1bb:
                                    mem8 = phys_mem8[mem_ptr++];
                                    y = regs[(mem8 >> 3) & 7];
                                    conditional_var = (OPbyte >> 3) & 3;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        set_lower_two_bytes_of_register(register_0, vc(conditional_var, regs[register_0], y));
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        mem8_loc = (mem8_loc + (((y & 0xffff) >> 4) << 1)) >> 0;
                                        x = ld_16bits_mem8_write();
                                        x = vc(conditional_var, x, y);
                                        st16_mem8_write(x);
                                    }
                                    break Fd;
                                case 0x1bc:
                                case 0x1bd:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        y = regs[mem8 & 7];
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        y = ld_16bits_mem8_read();
                                    }
                                    x = regs[register_1];
                                    if (OPbyte & 1)
                                        x = Ac(x, y);
                                    else
                                        x = yc(x, y);
                                    set_lower_two_bytes_of_register(register_1, x);
                                    break Fd;
                                case 0x1b1:
                                    mem8 = phys_mem8[mem_ptr++];
                                    register_1 = (mem8 >> 3) & 7;
                                    if ((mem8 >> 6) == 3) {
                                        register_0 = mem8 & 7;
                                        x = regs[register_0];
                                        y = do_16bit_math(5, regs[0], x);
                                        if (y == 0) {
                                            set_lower_two_bytes_of_register(register_0, regs[register_1]);
                                        } else {
                                            set_lower_two_bytes_of_register(0, x);
                                        }
                                    } else {
                                        mem8_loc = giant_get_mem8_loc_func(mem8);
                                        x = ld_16bits_mem8_write();
                                        y = do_16bit_math(5, regs[0], x);
                                        if (y == 0) {
                                            st16_mem8_write(regs[register_1]);
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
    return exit_code;
};


CPU_X86.prototype.exec = function(N_cycles) {
    var Dg, exit_code, final_cycle_count, va;
    final_cycle_count = this.cycle_count + N_cycles;
    exit_code = 256;
    va = null;
    while (this.cycle_count < final_cycle_count) {
        try {
            exit_code = this.exec_internal(final_cycle_count - this.cycle_count, va);
            if (exit_code != 256)
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
    return exit_code;
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


