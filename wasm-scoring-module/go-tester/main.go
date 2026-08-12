package main

import (
	"context"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

func main() {
	if len(os.Args) != 5 {
		fmt.Println("usage: go run . <path-to.wasm> <question> <ground_truth> <miner_answer>")
		os.Exit(1)
	}
	wasmPath, question, groundTruth, answer := os.Args[1], os.Args[2], os.Args[3], os.Args[4]

	wasmBytes, err := os.ReadFile(wasmPath)
	if err != nil {
		panic(err)
	}

	ctx := context.Background()
	rt := wazero.NewRuntime(ctx)
	defer rt.Close(ctx)

	mod, err := rt.Instantiate(ctx, wasmBytes)
	if err != nil {
		panic(fmt.Sprintf("module failed to load: %v", err))
	}
	defer mod.Close(ctx)

	mem := mod.Memory()
	if mem == nil {
		panic("module exports no linear memory")
	}

	alloc := mod.ExportedFunction("alloc")
	rankAnswer := mod.ExportedFunction("rank_answer")
	if alloc == nil || rankAnswer == nil {
		panic("module is missing a required export: alloc or rank_answer")
	}

	writeStr := func(s string) (ptr, length uint32) {
		if len(s) == 0 {
			return 0, 0
		}
		res, err := alloc.Call(ctx, uint64(len(s)))
		if err != nil {
			panic(fmt.Sprintf("alloc failed: %v", err))
		}
		p := uint32(res[0])
		if !mem.Write(p, []byte(s)) {
			panic("failed to write into module memory")
		}
		return p, uint32(len(s))
	}

	qPtr, qLen := writeStr(question)
	gtPtr, gtLen := writeStr(groundTruth)
	maPtr, maLen := writeStr(answer)

	res, err := rankAnswer.Call(ctx,
		uint64(qPtr), uint64(qLen),
		uint64(gtPtr), uint64(gtLen),
		uint64(maPtr), uint64(maLen),
	)
	if err != nil {
		panic(fmt.Sprintf("rank_answer failed: %v", err))
	}

	fmt.Printf("score: %.4f\n", api.DecodeF32(res[0]))
}
